import type { PathLike } from "node:fs";
import {
  constants,
  copyFile,
  writeFile,
  readFile,
  access,
} from "node:fs/promises";
import { extname } from "node:path";
import { styleText } from "node:util";

import { JSDOM, VirtualConsole } from "jsdom";

const DELAY = 8_000; // 8 seconds
const INPUT_FILE = undefined; // Set to a specific file name or leave undefined to use default files

const sleep = (delay: number) =>
  new Promise((resolve) => setTimeout(resolve, delay));

const isObject = (value: unknown) =>
  value !== null && typeof value === "object";

const fileExists = (path: PathLike) =>
  access(path, constants.R_OK).then(
    () => true,
    () => false,
  );

const DEFAULT_INPUT_FILES = ["input.txt", "input.json"];

const err = (message?: string, options?: ErrorOptions) => {
  throw new Error(`[ERROR] ${message}`, options);
};

const inputFile =
  INPUT_FILE ??
  DEFAULT_INPUT_FILES.find(async (file) => await fileExists(file)) ??
  err(
    `No input file found. Did you mean to set INPUT_FILE or create one of ${DEFAULT_INPUT_FILES}?`,
  );

console.log(`[INFO] reading input file: ${inputFile}`);

const inputContents = await readFile(inputFile, { encoding: "utf8" });

const input: unknown[] =
  extname(inputFile) === ".txt" ? inputContents.split("\n")
  : extname(inputFile) === ".json" ? JSON.parse(inputContents)
  : err(`Unsupported file type: ${inputFile}. Expected .txt or .json.`);

console.log(`[INFO] reading ${inputFile} successful, length: ${input.length}`);

let urlArray = input
  .map((item) =>
    typeof item === "string" ? item
    : isObject(item) && "url" in item && typeof item.url === "string" ? item.url
    : null,
  )
  .filter((url) => url !== null);
console.log(`[INFO] found ${urlArray.length} URLs in ${input.length} items`);

urlArray = Array.from(new Set(urlArray)).filter((url) => URL.canParse(url));
console.log(`[INFO] found ${urlArray.length} valid URLs`);

if (urlArray.length === 0) {
  err("No valid URLs found in input.");
}

const virtualConsole = new VirtualConsole();
virtualConsole.sendTo(console, { omitJSDOMErrors: true });
virtualConsole.on("jsdomError", (error) => {
  console.error(`[ERROR] JSDOM ${error}`);
});

const output: unknown[] = [];

try {
  // In this case, we actually want for fetching to not be parallel, so we don't
  // get rate-limited
  await Array.fromAsync(urlArray, async (url, index) => {
    await sleep(DELAY + Math.random() * DELAY); // [DELAY, 2 * DELAY) seconds
    console.log(
      `[INFO] processing ${url} (${index + 1}/${urlArray.length})...`,
    );
    const dom = await JSDOM.fromURL(url + ".json", {
      // https://www.useragents.me
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.3",
      runScripts: "dangerously",
      resources: "usable",
      virtualConsole,
      pretendToBeVisual: true,
    });

    const { window } = dom;

    const canonicalLink = window.document
      .querySelector("link[rel=canonical][href]")
      ?.getAttribute("href");

    // Get all `og:` meta tags
    const og = Array.from(
      window.document.querySelectorAll("meta[property^='og:']"),
    ).reduce<Record<string, string>>((acc, meta) => {
      const property = meta.getAttribute("property");
      const content = meta.getAttribute("content");
      if (property !== null && content !== null) {
        acc[property.slice("og:".length)] = content;
      }
      return acc;
    }, {});

    output.push({
      url,
      title: window.document.title,
      dateOfAccess: new Date().toISOString(),
      canonicalLink,
      og,
    });
    console.log(`[INFO] processed ${url}`);
    window.close();
  });
} catch (error) {
  console.error(styleText("red", `[ERROR] ${error}`));
} finally {
  console.log("[INFO] Finished processing URLs");

  const OUTPUT_FILE_NAME = "output.json";

  if (await fileExists(OUTPUT_FILE_NAME)) {
    console.log(
      `[INFO] ${OUTPUT_FILE_NAME} already exists, renaming to output-old.json`,
    );
    await copyFile(
      OUTPUT_FILE_NAME,
      "output-old.json",
      constants.COPYFILE_FICLONE,
    );
  }
  console.log(`[INFO] writing output to ${OUTPUT_FILE_NAME}...`);
  await writeFile(OUTPUT_FILE_NAME, JSON.stringify(output));

  console.log(
    `[INFO] writing output to ${OUTPUT_FILE_NAME} ${
      (await fileExists(OUTPUT_FILE_NAME)) ? "successful" : "failed"
    }`,
  );
}

console.log("[INFO] main.ts finished");
process.exit();
