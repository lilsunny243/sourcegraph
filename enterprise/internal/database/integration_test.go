package database

import (
	"flag"
	"testing"

	"github.com/sourcegraph/log/logtest"

	"github.com/sourcegraph/sourcegraph/internal/database"
	"github.com/sourcegraph/sourcegraph/internal/database/dbtest"
)

// Toggles particularly slow tests. To enable, use `go test` with this flag, for example:
//
//	go test -timeout 360s -v -run ^TestIntegration_PermsStore$ github.com/sourcegraph/sourcegraph/enterprise/internal/database -slow-tests
var slowTests = flag.Bool("slow-tests", false, "Enable very slow tests")

// postgresParameterLimitTest names tests that are focused on ensuring the default
// behaviour of various queries do not run into the Postgres parameter limit at scale
// (error `extended protocol limited to 65535 parameters`).
//
// They are typically flagged behind `-slow-tests` - when changing queries make sure to
// enable these tests and add more where relevant (see `slowTests`).
const postgresParameterLimitTest = "ensure we do not exceed postgres parameter limit"

func TestIntegration_PermsStore(t *testing.T) {
	if testing.Short() {
		t.Skip()
	}

	t.Parallel()

	logger := logtest.Scoped(t)

	testDb := dbtest.NewDB(logger, t)
	db := database.NewDB(logger, testDb)

	for _, tc := range []struct {
		name string
		test func(*testing.T)
	}{
		{"LoadUserPendingPermissions", testPermsStore_LoadUserPendingPermissions(db)},
		{"SetRepoPendingPermissions", testPermsStore_SetRepoPendingPermissions(db)},
		{"ListPendingUsers", testPermsStore_ListPendingUsers(db)},
		{"DeleteAllUserPendingPermissions", testPermsStore_DeleteAllUserPendingPermissions(db)},
		{"MapUsers", testPermsStore_MapUsers(db)},
	} {
		t.Run(tc.name, tc.test)
	}
}
