package exec

import (
	"context"
	"io"
	"os/exec"

	"github.com/sourcegraph/log"
)

// Cmd wraps an os/exec.Cmd into a thin layer than enables to set hooks for before and after the commands.
type Cmd struct {
	cmd         *exec.Cmd
	ctx         context.Context
	logger      log.Logger
	beforeHooks []BeforeHook
	afterHooks  []AfterHook
}

// BeforeHook are called before the execution of a command. Returning an error within a before
// hook prevents subsequent hooks and the command to be executed; all "running" commands such as Start, Run, Wait
// and others will return that error.
type BeforeHook func(context.Context, log.Logger, *exec.Cmd) error

// AfterHook are called once the execution of the command is completed, from a Go perspective. It means if
// a command were to be started with Start but Wait was never called, the after hook would never be called.
type AfterHook func(context.Context, log.Logger, *exec.Cmd)

// Cmder provides an interface modeled after os/exec.Cmd that enables to operate a level higher and to
// pass around various implementation, such as RecordingCommand, without having the receiver to know about it.
//
// The only new method is Unwrap() which allows to grab the underlying os/exec.Cmd if needed.
type Cmder interface {
	CombinedOutput() ([]byte, error)
	Environ() []string
	Output() ([]byte, error)
	Run() error
	Start() error
	StderrPipe() (io.ReadCloser, error)
	StdinPipe() (io.WriteCloser, error)
	StdoutPipe() (io.ReadCloser, error)
	String() string
	Wait() error

	Unwrap() *exec.Cmd
}

var _ Cmder = &Cmd{}

// Command constructs a new Cmd wrapper.
// If logger is nil, a no-op logger will be set.
func Command(ctx context.Context, logger log.Logger, name string, args ...string) *Cmd { // TODO
	cmd := exec.CommandContext(ctx, name, args...)
	return Wrap(ctx, logger, cmd)
}

// Wrap constructs a new Cmd based of an existing os/Exec.cmd command.
// If logger is nil, a no-op logger will be set.
func Wrap(ctx context.Context, logger log.Logger, cmd *exec.Cmd) *Cmd {
	// TODO?
	if logger == nil {
		logger = log.NoOp()
	}
	return &Cmd{
		cmd:    cmd,
		ctx:    ctx,
		logger: logger,
	}
}

// SetBeforeHooks installs hooks that will be called just before the underlying command
// is executed.
//
// If a hook returns an error, all error returning functions from the Cmder interface
// will return that error and no subsequent hooks will be called.
func (c *Cmd) SetBeforeHooks(hooks ...BeforeHook) {
	c.beforeHooks = hooks
}

// SetAfterHooks installs hooks that will be called once the underlying command completes,
// from a Go point of view. In practice, it means that even if the underlying command exits,
// the after hooks won't be called until Wait or any other methods that waits upon completion
// are called.
func (c *Cmd) SetAfterHooks(hooks ...AfterHook) {
	c.afterHooks = hooks
}

// Unwrap returns the underlying os/exec.Cmd, that can be safely modified unless
// the Cmd has been started.
func (c *Cmd) Unwrap() *exec.Cmd {
	return c.cmd
}

func (c *Cmd) runBeforeHooks() error {
	for _, h := range c.beforeHooks {
		if err := h(c.ctx, c.logger, c.cmd); err != nil {
			return err
		}
	}
	return nil
}

func (c *Cmd) runAfterHooks() {
	for _, h := range c.afterHooks {
		h(c.ctx, c.logger, c.cmd)
	}
}

// CombinedOutput calls os/exec.Cmd.CombinedOutput after running the before hooks,
// and run the after hooks once it returns.
func (c *Cmd) CombinedOutput() ([]byte, error) {
	if err := c.runBeforeHooks(); err != nil {
		return nil, err
	}
	defer c.runAfterHooks()
	return c.cmd.CombinedOutput()
}

// Environ returns the underlying command environ. It never call the hooks.
func (c *Cmd) Environ() []string {
	return c.cmd.Environ()
}

// Output calls os/exec.Cmd.Output after running the before hooks,
// and run the after hooks once it returns.
func (c *Cmd) Output() ([]byte, error) {
	if err := c.runBeforeHooks(); err != nil {
		return nil, err
	}
	defer c.runAfterHooks()
	return c.cmd.Output()
}

// Run calls os/exec.Cmd.Run after running the before hooks,
// and run the after hooks once it returns.
func (c *Cmd) Run() error {
	if err := c.runBeforeHooks(); err != nil {
		return err
	}
	defer c.runAfterHooks()
	return c.cmd.Run()
}

// Start calls os/exec.Cmd.Start after running the before hooks,
// but do not run the after hooks, because the command may not
// have exited yet. Wait must be used to make sure the after hooks
// are executed.
func (c *Cmd) Start() error {
	if err := c.runBeforeHooks(); err != nil {
		return err
	}
	return c.cmd.Start()
}

// StderrPipe calls os/exec.Cmd.StderrPipe, without running any hooks.
func (c *Cmd) StderrPipe() (io.ReadCloser, error) {
	return c.cmd.StderrPipe()
}

// StdinPipe calls os/exec.Cmd.StderrPipe, without running any hooks.
func (c *Cmd) StdinPipe() (io.WriteCloser, error) {
	return c.cmd.StdinPipe()
}

// StdoutPipe calls os/exec.Cmd.StderrPipe, without running any hooks.
func (c *Cmd) StdoutPipe() (io.ReadCloser, error) {
	return c.cmd.StdoutPipe()
}

// String calls os/exec.Cmd.String, without any modification.
func (c *Cmd) String() string {
	return c.cmd.String()
}

// Wait calls os/exec.Cmd.Wait and will run the after hooks once it returns.
func (c *Cmd) Wait() error {
	defer c.runAfterHooks()
	return c.cmd.Wait()
}
