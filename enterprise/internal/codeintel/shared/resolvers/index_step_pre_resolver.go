package sharedresolvers

import (
	"github.com/sourcegraph/sourcegraph/enterprise/internal/codeintel/shared/types"
	resolverstubs "github.com/sourcegraph/sourcegraph/internal/codeintel/resolvers"
	"github.com/sourcegraph/sourcegraph/internal/executor"
)

type preIndexStepResolver struct {
	siteAdminChecker SiteAdminChecker
	step             types.DockerStep
	entry            *executor.ExecutionLogEntry
}

func NewPreIndexStepResolver(siteAdminChecker SiteAdminChecker, step types.DockerStep, entry *executor.ExecutionLogEntry) resolverstubs.PreIndexStepResolver {
	return &preIndexStepResolver{
		siteAdminChecker: siteAdminChecker,
		step:             step,
		entry:            entry,
	}
}

func (r *preIndexStepResolver) Root() string       { return r.step.Root }
func (r *preIndexStepResolver) Image() string      { return r.step.Image }
func (r *preIndexStepResolver) Commands() []string { return r.step.Commands }

func (r *preIndexStepResolver) LogEntry() resolverstubs.ExecutionLogEntryResolver {
	if r.entry != nil {
		return NewExecutionLogEntryResolver(r.siteAdminChecker, *r.entry)
	}

	return nil
}
