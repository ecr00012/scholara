import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  diagnoseSecret,
  type SecretDiagnostic,
} from '../../ipc/secrets';

export function SecretDiagnosticPanel() {
  const [result, setResult] = useState<SecretDiagnostic | null>(null);
  const [running, setRunning] = useState(false);

  if (!import.meta.env.DEV) return null;

  const run = async () => {
    setRunning(true);
    try {
      setResult(await diagnoseSecret('gutenberg'));
    } catch (err) {
      setResult({
        service: 'scholara',
        account: 'gutenberg_api_key',
        diagnostic_account: 'gutenberg_diagnostic_api_key',
        existing_entry: false,
        status: 'invoke_failed',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
        Gutenberg Keychain Diagnostic
      </h2>
      <Button size="sm" variant="outline" onClick={run} disabled={running}>
        {running ? 'Checking…' : 'Run check'}
      </Button>
      {result && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-ink-muted">
          <dt>Status</dt>
          <dd className="font-mono text-ink">{result.status}</dd>
          <dt>Service</dt>
          <dd className="font-mono">{result.service}</dd>
          <dt>Account</dt>
          <dd className="font-mono">{result.account}</dd>
          <dt>Saved key</dt>
          <dd>{result.existing_entry ? 'found' : 'missing'}</dd>
          {result.error && (
            <>
              <dt>Error</dt>
              <dd className="text-accent-orange">{result.error}</dd>
            </>
          )}
        </dl>
      )}
    </section>
  );
}
