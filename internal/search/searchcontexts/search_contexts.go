package searchcontexts

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"sync"

	"github.com/cockroachdb/errors"
	"github.com/hashicorp/go-multierror"
	"github.com/inconshreveable/log15"
	"golang.org/x/sync/errgroup"
	"golang.org/x/sync/semaphore"

	"github.com/sourcegraph/sourcegraph/cmd/frontend/backend"
	"github.com/sourcegraph/sourcegraph/cmd/frontend/envvar"
	"github.com/sourcegraph/sourcegraph/internal/actor"
	"github.com/sourcegraph/sourcegraph/internal/api"
	"github.com/sourcegraph/sourcegraph/internal/database"
	"github.com/sourcegraph/sourcegraph/internal/database/dbutil"
	"github.com/sourcegraph/sourcegraph/internal/errcode"
	"github.com/sourcegraph/sourcegraph/internal/lazyregexp"
	"github.com/sourcegraph/sourcegraph/internal/search"
	"github.com/sourcegraph/sourcegraph/internal/search/query"
	"github.com/sourcegraph/sourcegraph/internal/types"
)

const (
	GlobalSearchContextName           = "global"
	searchContextSpecPrefix           = "@"
	maxSearchContextNameLength        = 32
	maxSearchContextDescriptionLength = 1024
	maxRevisionLength                 = 255
)

var (
	validateSearchContextNameRegexp   = lazyregexp.New(`^[a-zA-Z0-9_\-\/\.]+$`)
	namespacedSearchContextSpecRegexp = lazyregexp.New(searchContextSpecPrefix + `(.*?)\/(.*)`)
)

type ParsedSearchContextSpec struct {
	NamespaceName     string
	SearchContextName string
}

func ParseSearchContextSpec(searchContextSpec string) ParsedSearchContextSpec {
	if submatches := namespacedSearchContextSpecRegexp.FindStringSubmatch(searchContextSpec); submatches != nil {
		// We expect 3 submatches, because FindStringSubmatch returns entire string as first submatch, and 2 captured groups
		// as additional submatches
		namespaceName, searchContextName := submatches[1], submatches[2]
		return ParsedSearchContextSpec{NamespaceName: namespaceName, SearchContextName: searchContextName}
	} else if strings.HasPrefix(searchContextSpec, searchContextSpecPrefix) {
		return ParsedSearchContextSpec{NamespaceName: searchContextSpec[1:]}
	}
	return ParsedSearchContextSpec{SearchContextName: searchContextSpec}
}

func ResolveSearchContextSpec(ctx context.Context, db database.DB, searchContextSpec string) (*types.SearchContext, error) {
	parsedSearchContextSpec := ParseSearchContextSpec(searchContextSpec)
	hasNamespaceName := parsedSearchContextSpec.NamespaceName != ""
	hasSearchContextName := parsedSearchContextSpec.SearchContextName != ""

	if IsGlobalSearchContextSpec(searchContextSpec) {
		return GetGlobalSearchContext(), nil
	}

	if hasNamespaceName {
		namespace, err := db.Namespaces().GetByName(ctx, parsedSearchContextSpec.NamespaceName)
		if err != nil {
			return nil, errors.Wrap(err, "get namespace by name")
		}

		// Only member of the organization can use search contexts under the
		// organization namespace on Sourcegraph Cloud.
		if envvar.SourcegraphDotComMode() && namespace.Organization > 0 {
			_, err = db.OrgMembers().GetByOrgIDAndUserID(ctx, namespace.Organization, actor.FromContext(ctx).UID)
			if err != nil {
				if errcode.IsNotFound(err) {
					return nil, database.ErrNamespaceNotFound
				}

				log15.Error("ResolveSearchContextSpec.OrgMembers.GetByOrgIDAndUserID", "error", err)

				// NOTE: We do want to return identical error as if the namespace not found in
				// case of internal server error. Otherwise, we're leaking the information when
				// error occurs.
				return nil, database.ErrNamespaceNotFound
			}
		}

		if hasSearchContextName {
			return db.SearchContexts().GetSearchContext(ctx, database.GetSearchContextOptions{
				Name:            parsedSearchContextSpec.SearchContextName,
				NamespaceUserID: namespace.User,
				NamespaceOrgID:  namespace.Organization,
			})
		}

		if namespace.User == 0 && namespace.Organization == 0 {
			return nil, errors.Errorf("search context %q not found", searchContextSpec)
		}
		if namespace.User > 0 {
			return GetUserSearchContext(namespace.User, parsedSearchContextSpec.NamespaceName), nil
		}
		return GetOrganizationSearchContext(namespace.Organization, parsedSearchContextSpec.NamespaceName, parsedSearchContextSpec.NamespaceName), nil
	}

	// Check if instance-level context
	return db.SearchContexts().GetSearchContext(ctx, database.GetSearchContextOptions{Name: parsedSearchContextSpec.SearchContextName})
}

func ValidateSearchContextWriteAccessForCurrentUser(ctx context.Context, db database.DB, namespaceUserID, namespaceOrgID int32, public bool) error {
	if namespaceUserID != 0 && namespaceOrgID != 0 {
		return errors.New("namespaceUserID and namespaceOrgID are mutually exclusive")
	}

	user, err := backend.CurrentUser(ctx, db)
	if err != nil {
		return err
	}
	if user == nil {
		return errors.New("current user not found")
	}

	// Site-admins have write access to all public search contexts
	if user.SiteAdmin && public {
		return nil
	}

	if namespaceUserID == 0 && namespaceOrgID == 0 && !user.SiteAdmin {
		// Only site-admins have write access to instance-level search contexts
		return errors.New("current user must be site-admin")
	} else if namespaceUserID != 0 && namespaceUserID != user.ID {
		// Only the creator of the search context has write access to its search contexts
		return errors.New("search context user does not match current user")
	} else if namespaceOrgID != 0 {
		// Only members of the org have write access to org search contexts
		membership, err := db.OrgMembers().GetByOrgIDAndUserID(ctx, namespaceOrgID, user.ID)
		if err != nil {
			return err
		}
		if membership == nil {
			return errors.New("current user is not an org member")
		}
	}

	return nil
}

func validateSearchContextName(name string) error {
	if len(name) > maxSearchContextNameLength {
		return errors.Errorf("search context name %q exceeds maximum allowed length (%d)", name, maxSearchContextNameLength)
	}

	if !validateSearchContextNameRegexp.MatchString(name) {
		return errors.Errorf("%q is not a valid search context name", name)
	}

	return nil
}

func validateSearchContextDescription(description string) error {
	if len(description) > maxSearchContextDescriptionLength {
		return errors.Errorf("search context description exceeds maximum allowed length (%d)", maxSearchContextDescriptionLength)
	}
	return nil
}

func validateSearchContextRepositoryRevisions(repositoryRevisions []*types.SearchContextRepositoryRevisions) error {
	for _, repository := range repositoryRevisions {
		for _, revision := range repository.Revisions {
			if len(revision) > maxRevisionLength {
				return errors.Errorf("revision %q exceeds maximum allowed length (%d)", revision, maxRevisionLength)
			}
		}
	}
	return nil
}

func validateSearchContextRepositoryQuery(repositoryQuery string) error {
	if repositoryQuery == "" {
		return nil
	}

	plan, err := query.Pipeline(query.Init(repositoryQuery, query.SearchTypeRegex))
	if err != nil {
		return err
	}

	errs := new(multierror.Error)
	query.VisitParameter(plan.ToParseTree(), func(field, value string, negated bool, a query.Annotation) {
		switch field {
		case query.FieldRepo:
			if a.Labels.IsSet(query.IsPredicate) {
				errs = multierror.Append(errs,
					errors.Errorf("unsupported repo field predicate in repository query: %q", value))
				return
			}

			repoRegex, revs := search.ParseRepositoryRevisions(value)

			for _, rev := range revs {
				if rev.RevSpec == "" {
					errs = multierror.Append(errs,
						errors.Errorf("unsupported rev glob in repository query: %q", value))
					return
				}
			}

			_, err := regexp.Compile(repoRegex)
			if err != nil {
				errs = multierror.Append(errs,
					errors.Errorf("repo field regex %q is invalid: %v", value, err))
				return
			}

		case query.FieldFork:
		case query.FieldArchived:
		case query.FieldVisibility:
		case query.FieldCase:

		default:
			errs = multierror.Append(errs,
				errors.Errorf("unsupported field in repository query: %q", field))
		}
	})

	return errs.ErrorOrNil()
}

func validateSearchContextDoesNotExist(ctx context.Context, db dbutil.DB, searchContext *types.SearchContext) error {
	_, err := database.SearchContexts(db).GetSearchContext(ctx, database.GetSearchContextOptions{
		Name:            searchContext.Name,
		NamespaceUserID: searchContext.NamespaceUserID,
		NamespaceOrgID:  searchContext.NamespaceOrgID,
	})
	if err == nil {
		return errors.New("search context already exists")
	}
	if err == database.ErrSearchContextNotFound {
		return nil
	}
	// Unknown error
	return err
}

func CreateSearchContextWithRepositoryRevisions(
	ctx context.Context,
	db database.DB,
	searchContext *types.SearchContext,
	repositoryRevisions []*types.SearchContextRepositoryRevisions,
) (*types.SearchContext, error) {
	if IsGlobalSearchContext(searchContext) {
		return nil, errors.New("cannot override global search context")
	}

	err := ValidateSearchContextWriteAccessForCurrentUser(ctx, db, searchContext.NamespaceUserID, searchContext.NamespaceOrgID, searchContext.Public)
	if err != nil {
		return nil, err
	}

	err = validateSearchContextName(searchContext.Name)
	if err != nil {
		return nil, err
	}

	err = validateSearchContextDescription(searchContext.Description)
	if err != nil {
		return nil, err
	}

	if searchContext.RepositoryQuery != "" && len(repositoryRevisions) > 0 {
		return nil, errors.New("repository query and repository revisions are mutually exclusive")
	}

	if searchContext.RepositoryQuery == "" && len(repositoryRevisions) == 0 {
		return nil, errors.New("either repository query or repository revisions must be defined")
	}

	err = validateSearchContextRepositoryRevisions(repositoryRevisions)
	if err != nil {
		return nil, err
	}

	err = validateSearchContextRepositoryQuery(searchContext.RepositoryQuery)
	if err != nil {
		return nil, err
	}

	err = validateSearchContextDoesNotExist(ctx, db, searchContext)
	if err != nil {
		return nil, err
	}

	searchContext, err = db.SearchContexts().CreateSearchContextWithRepositoryRevisions(ctx, searchContext, repositoryRevisions)
	if err != nil {
		return nil, err
	}
	return searchContext, nil
}

func UpdateSearchContextWithRepositoryRevisions(ctx context.Context, db database.DB, searchContext *types.SearchContext, repositoryRevisions []*types.SearchContextRepositoryRevisions) (*types.SearchContext, error) {
	if IsGlobalSearchContext(searchContext) {
		return nil, errors.New("cannot update global search context")
	}

	err := ValidateSearchContextWriteAccessForCurrentUser(ctx, db, searchContext.NamespaceUserID, searchContext.NamespaceOrgID, searchContext.Public)
	if err != nil {
		return nil, err
	}

	err = validateSearchContextName(searchContext.Name)
	if err != nil {
		return nil, err
	}

	err = validateSearchContextDescription(searchContext.Description)
	if err != nil {
		return nil, err
	}

	if searchContext.RepositoryQuery != "" && len(repositoryRevisions) > 0 {
		return nil, errors.New("repository query and repository revisions are mutually exclusive")
	}

	if searchContext.RepositoryQuery == "" && len(repositoryRevisions) == 0 {
		return nil, errors.New("either repository query or repository revisions must be defined")
	}

	err = validateSearchContextRepositoryRevisions(repositoryRevisions)
	if err != nil {
		return nil, err
	}

	err = validateSearchContextRepositoryQuery(searchContext.RepositoryQuery)
	if err != nil {
		return nil, err
	}

	searchContext, err = db.SearchContexts().UpdateSearchContextWithRepositoryRevisions(ctx, searchContext, repositoryRevisions)
	if err != nil {
		return nil, err
	}
	return searchContext, nil
}

func DeleteSearchContext(ctx context.Context, db database.DB, searchContext *types.SearchContext) error {
	if IsAutoDefinedSearchContext(searchContext) {
		return errors.New("cannot delete auto-defined search context")
	}

	err := ValidateSearchContextWriteAccessForCurrentUser(ctx, db, searchContext.NamespaceUserID, searchContext.NamespaceOrgID, searchContext.Public)
	if err != nil {
		return err
	}

	return db.SearchContexts().DeleteSearchContext(ctx, searchContext.ID)
}

func GetAutoDefinedSearchContexts(ctx context.Context, db database.DB) ([]*types.SearchContext, error) {
	searchContexts := []*types.SearchContext{GetGlobalSearchContext()}
	a := actor.FromContext(ctx)
	if !a.IsAuthenticated() || !envvar.SourcegraphDotComMode() {
		return searchContexts, nil
	}

	user, err := db.Users().GetByID(ctx, a.UID)
	if err != nil {
		return nil, err
	}
	searchContexts = append(searchContexts, GetUserSearchContext(a.UID, user.Username))

	organizations, err := db.Orgs().GetOrgsWithRepositoriesByUserID(ctx, a.UID)
	if err != nil {
		return nil, err
	}

	for _, org := range organizations {
		searchContexts = append(searchContexts, GetOrganizationSearchContext(org.ID, org.Name, *org.DisplayName))
	}
	return searchContexts, nil
}

func GetAllRevisionsForRepos(ctx context.Context, db database.DB, repoIDs []api.RepoID) (map[api.RepoID][]string, error) {
	sc := db.SearchContexts()

	revs, err := sc.GetAllRevisionsForRepos(ctx, repoIDs)
	if err != nil {
		return nil, err
	}

	repoQueries, err := sc.GetAllRepositoryQueries(ctx)
	if err != nil {
		return nil, err
	}

	var rqs []RepositoryQuery
	for _, q := range repoQueries {
		qs, err := ParseRepositoryQuery(q)
		if err != nil {
			return nil, err
		}
		rqs = append(rqs, qs...)
	}

	repos := db.Repos()
	sem := semaphore.NewWeighted(4)
	g, ctx := errgroup.WithContext(ctx)
	mu := sync.Mutex{}

	for _, q := range rqs {
		q := q
		g.Go(func() error {
			if err := sem.Acquire(ctx, 1); err != nil {
				return err
			}
			defer sem.Release(1)

			opts := q.ReposListOptions
			opts.IDs = repoIDs

			rs, err := repos.ListMinimalRepos(ctx, opts)
			if err != nil {
				return err
			}

			mu.Lock()
			defer mu.Unlock()

			for _, r := range rs {
				revs[r.ID] = append(revs[r.ID], q.RevSpecs...)
			}

			return nil
		})
	}

	err = g.Wait()
	if err != nil {
		return nil, err
	}

	return revs, nil
}

type RepositoryQuery struct {
	database.ReposListOptions
	RevSpecs []string
}

func ParseRepositoryQuery(repositoryQuery string) ([]RepositoryQuery, error) {
	plan, err := query.Pipeline(query.Init(repositoryQuery, query.SearchTypeRegex))
	if err != nil {
		return nil, err
	}

	qs := make([]RepositoryQuery, 0, len(plan))
	for _, p := range plan {
		q := p.ToParseTree()

		repoFilters, minusRepoFilters := q.Repositories()

		fork := query.No
		if setFork := q.Fork(); setFork != nil {
			fork = *setFork
		}

		archived := query.No
		if setArchived := q.Archived(); setArchived != nil {
			archived = *setArchived
		}

		visibilityStr, _ := q.StringValue(query.FieldVisibility)
		visibility := query.ParseVisibility(visibilityStr)

		rq := RepositoryQuery{
			ReposListOptions: database.ReposListOptions{
				CaseSensitivePatterns: q.IsCaseSensitive(),
				ExcludePattern:        search.UnionRegExps(minusRepoFilters),
				OnlyForks:             fork == query.Only,
				NoForks:               fork == query.No,
				OnlyArchived:          archived == query.Only,
				NoArchived:            archived == query.No,
				NoPrivate:             visibility == query.Public,
				OnlyPrivate:           visibility == query.Private,
			},
		}

		for _, r := range repoFilters {
			repoFilter, revs := search.ParseRepositoryRevisions(r)
			for _, rev := range revs {
				if rev.RevSpec != "" {
					rq.RevSpecs = append(rq.RevSpecs, rev.RevSpec)
				}
			}
			rq.IncludePatterns = append(rq.IncludePatterns, repoFilter)
		}

		qs = append(qs, rq)
	}

	return qs, nil
}

func GetRepositoryRevisions(ctx context.Context, db database.DB, searchContextID int64) ([]*search.RepositoryRevisions, error) {
	searchContextRepositoryRevisions, err := db.SearchContexts().GetSearchContextRepositoryRevisions(ctx, searchContextID)
	if err != nil {
		return nil, err
	}

	repositoryRevisions := make([]*search.RepositoryRevisions, 0, len(searchContextRepositoryRevisions))
	for _, searchContextRepositoryRevision := range searchContextRepositoryRevisions {
		revisionSpecs := make([]search.RevisionSpecifier, 0, len(searchContextRepositoryRevision.Revisions))
		for _, revision := range searchContextRepositoryRevision.Revisions {
			revisionSpecs = append(revisionSpecs, search.RevisionSpecifier{RevSpec: revision})
		}
		repositoryRevisions = append(repositoryRevisions, &search.RepositoryRevisions{Repo: searchContextRepositoryRevision.Repo, Revs: revisionSpecs})
	}
	return repositoryRevisions, nil
}

func IsAutoDefinedSearchContext(searchContext *types.SearchContext) bool {
	return searchContext.ID == 0
}

func IsInstanceLevelSearchContext(searchContext *types.SearchContext) bool {
	return searchContext.NamespaceUserID == 0 && searchContext.NamespaceOrgID == 0
}

func IsGlobalSearchContextSpec(searchContextSpec string) bool {
	// Empty search context spec resolves to global search context
	return searchContextSpec == "" || searchContextSpec == GlobalSearchContextName
}

func IsGlobalSearchContext(searchContext *types.SearchContext) bool {
	return searchContext != nil && searchContext.Name == GlobalSearchContextName
}

func GetUserSearchContext(userID int32, name string) *types.SearchContext {
	return &types.SearchContext{Name: name, Public: true, Description: "All repositories you've added to Sourcegraph", NamespaceUserID: userID}
}

func GetOrganizationSearchContext(orgID int32, name string, displayName string) *types.SearchContext {
	return &types.SearchContext{Name: name, Public: false, Description: fmt.Sprintf("All repositories %s organization added to Sourcegraph", displayName), NamespaceOrgID: orgID}
}

func GetGlobalSearchContext() *types.SearchContext {
	return &types.SearchContext{Name: GlobalSearchContextName, Public: true, Description: "All repositories on Sourcegraph"}
}

func GetSearchContextSpec(searchContext *types.SearchContext) string {
	if IsInstanceLevelSearchContext(searchContext) {
		return searchContext.Name
	} else if IsAutoDefinedSearchContext(searchContext) {
		return searchContextSpecPrefix + searchContext.Name
	} else {
		var namespaceName string
		if searchContext.NamespaceUserName != "" {
			namespaceName = searchContext.NamespaceUserName
		} else {
			namespaceName = searchContext.NamespaceOrgName
		}
		return searchContextSpecPrefix + namespaceName + "/" + searchContext.Name
	}
}
