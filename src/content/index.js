import { adapterForOrigin } from './adapters/index.js';
import { startLiveScanner } from './live-scanner.js';
const adapter = adapterForOrigin(location.origin);
if (adapter) startLiveScanner(adapter);
