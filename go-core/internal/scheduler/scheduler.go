package scheduler

import (
	"context"
	"log"
	"sync"
	"time"
)

// Job is a scheduled unit of work.
type Job func(ctx context.Context)

// Scheduler runs jobs on intervals as goroutines, with graceful shutdown. It
// replaces the Node setInterval/node-cron schedulers (one goroutine per job
// instead of timers sharing the main event loop).
type Scheduler struct {
	mu      sync.Mutex
	cancels []context.CancelFunc
	wg      sync.WaitGroup
}

func New() *Scheduler { return &Scheduler{} }

// Every runs job immediately is false; it first waits one interval, then repeats
// every d until Stop. name is for logging.
func (s *Scheduler) Every(name string, d time.Duration, job Job) {
	ctx, cancel := context.WithCancel(context.Background())
	s.mu.Lock()
	s.cancels = append(s.cancels, cancel)
	s.mu.Unlock()
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		t := time.NewTicker(d)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.run(ctx, name, job)
			}
		}
	}()
}

// DailyAt runs job once per day at the given hour:minute (local time), starting
// at the next occurrence.
func (s *Scheduler) DailyAt(name string, hour, minute int, job Job) {
	ctx, cancel := context.WithCancel(context.Background())
	s.mu.Lock()
	s.cancels = append(s.cancels, cancel)
	s.mu.Unlock()
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		for {
			d := untilNext(time.Now(), hour, minute)
			select {
			case <-ctx.Done():
				return
			case <-time.After(d):
				s.run(ctx, name, job)
			}
		}
	}()
}

func (s *Scheduler) run(ctx context.Context, name string, job Job) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[scheduler] job %q panicked: %v", name, r)
		}
	}()
	job(ctx)
}

// untilNext returns the duration until the next hour:minute from `from`.
func untilNext(from time.Time, hour, minute int) time.Duration {
	next := time.Date(from.Year(), from.Month(), from.Day(), hour, minute, 0, 0, from.Location())
	if !next.After(from) {
		next = next.AddDate(0, 0, 1)
	}
	return next.Sub(from)
}

// Stop cancels all jobs and waits for in-flight runs to finish.
func (s *Scheduler) Stop() {
	s.mu.Lock()
	for _, c := range s.cancels {
		c()
	}
	s.cancels = nil
	s.mu.Unlock()
	s.wg.Wait()
}
