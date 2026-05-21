import { Plugin } from 'vite';

interface DotuixPluginOptions {
    /**
     * Manifest field overrides. Merged on top of uix.config.ts or manifest.json.
     * If neither exists, this object must supply all required fields.
     */
    manifest?: Record<string, unknown>;
    /**
     * Output path for the .uix file.
     * Default: <projectRoot>/<appId-tail>.uix
     */
    output?: string;
    /**
     * Inject the mock window.uix bridge in dev / preview mode.
     * Set to false to disable (e.g. when testing against a real viewer).
     * @default true
     */
    mockBridge?: boolean;
}
/**
 * Vite plugin that builds .uix apps.
 *
 * Supports:
 *  - uix.config.ts  (recommended for Vite projects)
 *  - manifest.json  (legacy / direct authoring)
 *
 * In dev / preview mode the plugin injects a window.uix bridge backed by
 * IndexedDB so the app runs without a real dotuix viewer.
 */
declare function dotuix(options?: DotuixPluginOptions): Plugin;

export { type DotuixPluginOptions, dotuix as default, dotuix };
