// Stub — node:fs is not available in the browser.
// @dotuix/core's Node.js-only functions (pack, unpack, openData, …) throw
// if called here, which is correct — the browser viewer only uses *Buffer variants.
const unavailable = (name: string) => () => {
  throw new Error(`node:fs.${name} is not available in the browser`);
};

export const readFileSync = unavailable("readFileSync");
export const writeFileSync = unavailable("writeFileSync");
export const renameSync = unavailable("renameSync");
export const mkdirSync = unavailable("mkdirSync");
export const rmSync = unavailable("rmSync");
export const existsSync = () => false;
export const statSync = unavailable("statSync");
export const readdirSync = () => [] as string[];
export const createWriteStream = unavailable("createWriteStream");
