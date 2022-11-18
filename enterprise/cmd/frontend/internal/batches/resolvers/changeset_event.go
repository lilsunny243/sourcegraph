package resolvers

import (
	"time"

	"github.com/graph-gophers/graphql-go"
	"github.com/graph-gophers/graphql-go/relay"

	"github.com/sourcegraph/sourcegraph/cmd/frontend/graphqlbackend"
	"github.com/sourcegraph/sourcegraph/enterprise/internal/batches/store"
	"github.com/sourcegraph/sourcegraph/internal/gqlutil"
)

type changesetEventResolver struct {
	store             *store.Store
	changesetResolver *changesetResolver
	// *btypes.ChangesetEvent
}

const changesetEventIDKind = "ChangesetEvent"

func marshalChangesetEventID(id int64) graphql.ID {
	return relay.MarshalID(changesetEventIDKind, id)
}

func (r *changesetEventResolver) ID() graphql.ID {
	return marshalChangesetEventID(0)
}

func (r *changesetEventResolver) CreatedAt() gqlutil.DateTime {
	return gqlutil.DateTime{Time: time.Now()}
}

func (r *changesetEventResolver) Changeset() graphqlbackend.ExternalChangesetResolver {
	return r.changesetResolver
}
