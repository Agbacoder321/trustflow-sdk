import { CircuitBreaker } from '../src/utils/circuit-breaker';

describe('CircuitBreaker (#626)', () => {
  it('resets successCount to 0 when a call fails during HALF_OPEN state', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      successThreshold: 2,
      resetTimeoutMs: 10,
    });

    // Trigger failure to open circuit
    try {
      await breaker.execute(async () => {
        throw new Error('fail');
      });
    } catch {
      // expected
    }

    // Wait for retry timeout
    await new Promise(r => setTimeout(r, 20));

    // Confirm HALF_OPEN
    expect(breaker.getState()).toBe('HALF_OPEN');

    // Record a success (successCount becomes 1)
    await breaker.execute(async () => {
      return 'ok';
    });

    // Confirm successCount is 1 (not at threshold yet)
    expect(breaker.getDiagnostics().successCount).toBe(1);

    // Fail a call in HALF_OPEN (should reset successCount to 0)
    try {
      await breaker.execute(async () => {
        throw new Error('fail again');
      });
    } catch {
      // expected
    }

    // Circuit should be OPEN again
    expect(breaker.getState()).toBe('OPEN');

    // successCount should be 0 (reset by onFailure)
    expect(breaker.getDiagnostics().successCount).toBe(0);

    // Wait for retry timeout again
    await new Promise(r => setTimeout(r, 20));

    // Now succeed twice to properly close the circuit
    await breaker.execute(async () => 'ok1');
    expect(breaker.getDiagnostics().successCount).toBe(1);

    await breaker.execute(async () => 'ok2');
    expect(breaker.getDiagnostics().successCount).toBe(0); // Reset to 0 when CLOSED

    // Circuit should be CLOSED
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('requires independent successThreshold successes after each HALF_OPEN transition', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      successThreshold: 2,
      resetTimeoutMs: 10,
    });

    // First cycle: open and transition to HALF_OPEN
    try {
      await breaker.execute(async () => {
        throw new Error('fail');
      });
    } catch {
      // expected
    }

    await new Promise(r => setTimeout(r, 20));
    expect(breaker.getState()).toBe('HALF_OPEN');

    // First success in HALF_OPEN
    await breaker.execute(async () => 'ok1');
    expect(breaker.getDiagnostics().successCount).toBe(1);

    // Fail in HALF_OPEN (reset successCount to 0 and reopen)
    try {
      await breaker.execute(async () => {
        throw new Error('fail');
      });
    } catch {
      // expected
    }

    expect(breaker.getState()).toBe('OPEN');
    expect(breaker.getDiagnostics().successCount).toBe(0);

    // Second cycle: wait for timeout and transition to HALF_OPEN again
    await new Promise(r => setTimeout(r, 20));
    expect(breaker.getState()).toBe('HALF_OPEN');

    // Must accumulate successThreshold successes again (starting from 0)
    await breaker.execute(async () => 'ok1');
    expect(breaker.getDiagnostics().successCount).toBe(1);

    await breaker.execute(async () => 'ok2');
    expect(breaker.getDiagnostics().successCount).toBe(0); // Reset when closed

    expect(breaker.getState()).toBe('CLOSED');
  });

  it('prevents closing if a failure occurs during HALF_OPEN recovery', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      successThreshold: 3,
      resetTimeoutMs: 10,
    });

    // Open the circuit
    try {
      await breaker.execute(async () => {
        throw new Error('fail');
      });
    } catch {
      // expected
    }

    await new Promise(r => setTimeout(r, 20));
    expect(breaker.getState()).toBe('HALF_OPEN');

    // First two successes
    await breaker.execute(async () => 'ok1');
    expect(breaker.getDiagnostics().successCount).toBe(1);

    await breaker.execute(async () => 'ok2');
    expect(breaker.getDiagnostics().successCount).toBe(2);

    // Fail on third call (before reaching threshold of 3)
    try {
      await breaker.execute(async () => {
        throw new Error('fail');
      });
    } catch {
      // expected
    }

    // Should reopen and reset successCount
    expect(breaker.getState()).toBe('OPEN');
    expect(breaker.getDiagnostics().successCount).toBe(0);

    // Must start over and reach threshold of 3 (not 1) to close
    await new Promise(r => setTimeout(r, 20));
    expect(breaker.getState()).toBe('HALF_OPEN');

    await breaker.execute(async () => 'ok1');
    expect(breaker.getDiagnostics().successCount).toBe(1);

    await breaker.execute(async () => 'ok2');
    expect(breaker.getDiagnostics().successCount).toBe(2);

    await breaker.execute(async () => 'ok3');
    expect(breaker.getDiagnostics().successCount).toBe(0); // Reset when closed

    expect(breaker.getState()).toBe('CLOSED');
  });

  it('handles synchronous execute variant with same state transitions', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      successThreshold: 2,
      resetTimeoutMs: 10,
    });

    // Trigger failure
    try {
      breaker.executeSync(() => {
        throw new Error('fail');
      });
    } catch {
      // expected
    }

    await new Promise(r => setTimeout(r, 20));
    expect(breaker.getState()).toBe('HALF_OPEN');

    // Succeed
    const result = breaker.executeSync(() => 'ok');
    expect(result).toBe('ok');
    expect(breaker.getDiagnostics().successCount).toBe(1);

    // Fail in HALF_OPEN
    try {
      breaker.executeSync(() => {
        throw new Error('fail');
      });
    } catch {
      // expected
    }

    expect(breaker.getState()).toBe('OPEN');
    expect(breaker.getDiagnostics().successCount).toBe(0);
  });
});
