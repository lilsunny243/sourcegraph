package codeintel

import (
	"context"

	"github.com/sourcegraph/sourcegraph/cmd/worker/job"
	"github.com/sourcegraph/sourcegraph/enterprise/cmd/worker/shared/init/codeintel"
	"github.com/sourcegraph/sourcegraph/enterprise/internal/codeintel/ranking"
	"github.com/sourcegraph/sourcegraph/internal/env"
	"github.com/sourcegraph/sourcegraph/internal/goroutine"
	"github.com/sourcegraph/sourcegraph/internal/observation"
)

type rankingJob struct{}

func NewRankingFileReferenceCounter() job.Job {
	return &rankingJob{}
}

func (j *rankingJob) Description() string {
	return ""
}

func (j *rankingJob) Config() []env.Config {
	return []env.Config{
		ranking.ConfigInst,
	}
}

func (j *rankingJob) Routines(_ context.Context, observationCtx *observation.Context) ([]goroutine.BackgroundRoutine, error) {
	services, err := codeintel.InitServices(observationCtx)
	if err != nil {
		return nil, err
	}

	routines := []goroutine.BackgroundRoutine{
		ranking.NewSymbolExporter(observationCtx, services.RankingService),
		ranking.NewMapper(observationCtx, services.RankingService),
		ranking.NewReducer(observationCtx, services.RankingService),
	}
	routines = append(routines, ranking.NewSymbolJanitor(observationCtx, services.RankingService)...)

	return routines, nil
}
