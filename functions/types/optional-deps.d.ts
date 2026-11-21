declare module '@sparticuz/chromium' {
  interface ChromiumRuntime {
    args: string[];
    executablePath: () => Promise<string>;
    default?: {
      args: string[];
      executablePath: () => Promise<string>;
    };
  }
  const chromium: ChromiumRuntime;
  export = chromium;
}

declare module 'puppeteer-core' {
  interface PuppeteerPage {
    setContent: (html: string, options?: Record<string, unknown>) => Promise<void>;
    pdf: (options?: Record<string, unknown>) => Promise<Uint8Array>;
  }
  interface PuppeteerBrowser {
    newPage: () => Promise<PuppeteerPage>;
    close: () => Promise<void>;
  }
  interface PuppeteerCore {
    defaultArgs: (options: { args?: string[]; headless?: boolean | 'shell' }) => string[];
    launch: (options: Record<string, unknown>) => Promise<PuppeteerBrowser>;
  }
  const puppeteer: PuppeteerCore;
  export = puppeteer;
}
