package types

import (
	"strings"
	"time"

	"github.com/sourcegraph/sourcegraph/internal/workerutil"
)

// BatchSpecResolutionJobState defines the possible states of a batch spec resolution job.
type BatchSpecResolutionJobState string

// BatchSpecResolutionJobState constants.
const (
	BatchSpecResolutionJobStateQueued     BatchSpecResolutionJobState = "queued"
	BatchSpecResolutionJobStateProcessing BatchSpecResolutionJobState = "processing"
	BatchSpecResolutionJobStateErrored    BatchSpecResolutionJobState = "errored"
	BatchSpecResolutionJobStateFailed     BatchSpecResolutionJobState = "failed"
	BatchSpecResolutionJobStateCompleted  BatchSpecResolutionJobState = "completed"
)

// Valid returns true if the given BatchSpecResolutionJobState is valid.
func (s BatchSpecResolutionJobState) Valid() bool {
	switch s {
	case BatchSpecResolutionJobStateQueued,
		BatchSpecResolutionJobStateProcessing,
		BatchSpecResolutionJobStateErrored,
		BatchSpecResolutionJobStateFailed,
		BatchSpecResolutionJobStateCompleted:
		return true
	default:
		return false
	}
}

// ToGraphQL returns the GraphQL representation of the worker state.
func (s BatchSpecResolutionJobState) ToGraphQL() string { return strings.ToUpper(string(s)) }

// BatchSpecResolutionJobStage defines the possible stages of a batch spec resolution job.
type BatchSpecResolutionJobStage string

// BatchSpecResolutionJobStage constants.
const (
	BatchSpecResolutionJobStageResolveWorkspaces            BatchSpecResolutionJobStage = "resolve_workspaces"
	BatchSpecResolutionJobStageResolveDetermineRepositories BatchSpecResolutionJobStage = "determine_repositories"
	BatchSpecResolutionJobStageResolveFindIgnored           BatchSpecResolutionJobStage = "find_ignored"
	BatchSpecResolutionJobStageResolveFindWorkspaces        BatchSpecResolutionJobStage = "find_workspaces"
	BatchSpecResolutionJobStageBuildWorkspaceCache          BatchSpecResolutionJobStage = "build_workspace_cache"
	BatchSpecResolutionJobStageImportingChangesets          BatchSpecResolutionJobStage = "importing_changesets"
	BatchSpecResolutionJobStageCreatingWorkspaces           BatchSpecResolutionJobStage = "creating_workspaces"
)

// ToGraphQL returns the GraphQL representation of the stage.
func (s BatchSpecResolutionJobStage) ToGraphQL() string { return strings.ToUpper(string(s)) }

type BatchSpecResolutionJob struct {
	ID int64

	BatchSpecID int64
	// InitiatorID is the user ID of the user who initiated the resolution job.
	// Currently, this is always the person who created the batch spec but we will
	// change this in the future when we split those two operations.
	InitiatorID int32

	Stage BatchSpecResolutionJobStage

	// workerutil fields
	State           BatchSpecResolutionJobState
	FailureMessage  *string
	StartedAt       time.Time
	FinishedAt      time.Time
	ProcessAfter    time.Time
	NumResets       int64
	NumFailures     int64
	LastHeartbeatAt time.Time

	ExecutionLogs  []workerutil.ExecutionLogEntry
	WorkerHostname string

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (j *BatchSpecResolutionJob) RecordID() int {
	return int(j.ID)
}
