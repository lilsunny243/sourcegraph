module progress-bot

go 1.16

require (
	cloud.google.com/go/storage v1.29.0
	github.com/cockroachdb/errors v1.8.6
	github.com/cockroachdb/logtags v0.0.0-20211118104740-dabe8e521a4f // indirect
	github.com/cockroachdb/redact v1.1.3 // indirect
	github.com/drexedam/gravatar v0.0.0-20210327211422-e94eea8c338e
	github.com/golang/groupcache v0.0.0-20210331224755-41bb18bfe9da // indirect
	github.com/ozankasikci/go-image-merge v0.2.2
	github.com/slack-go/slack v0.10.1
	github.com/yuin/goldmark v1.4.13
	google.golang.org/grpc v1.56.3 // indirect
)

replace github.com/ozankasikci/go-image-merge => github.com/sourcegraph/go-image-merge v0.2.3-0.20210226214948-f91742c8193e
