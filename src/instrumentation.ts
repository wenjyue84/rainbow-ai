/**
 * instrumentation.ts — OpenTelemetry SDK bootstrap
 *
 * Loaded via --import flag before the application starts.
 * Configures OTLP trace + metrics export when OTEL_EXPORTER_OTLP_ENDPOINT is set.
 * No-ops gracefully when the env var is absent (dev/test).
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

// Enable OTel debug logging when OTEL_LOG_LEVEL=debug
const logLevel = process.env.OTEL_LOG_LEVEL === 'debug' ? DiagLogLevel.DEBUG : DiagLogLevel.WARN;
diag.setLogger(new DiagConsoleLogger(), logLevel);

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (endpoint) {
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'rainbow-ai',
    [ATTR_SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
  });

  const traceExporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });
  const metricExporter = new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` });

  const sdk = new NodeSDK({
    resource,
    spanProcessors: [new BatchSpanProcessor(traceExporter)],
    metricReader: new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 30_000,
    }),
  });

  sdk.start();
  console.log(`[OTel] Tracing enabled — exporting to ${endpoint}`);

  // Graceful shutdown
  const shutdown = async () => {
    try { await sdk.shutdown(); } catch { /* ignore */ }
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
} else {
  console.log('[OTel] OTEL_EXPORTER_OTLP_ENDPOINT not set — tracing disabled');
}
