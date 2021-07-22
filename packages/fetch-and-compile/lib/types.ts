import type { WorkflowCompileResult } from "@truffle/compile-common";
import type { SourceInfo } from "@truffle/source-fetcher";

export type FailureType = "fetch" | "compile";

export interface SingleResult {
  compileResult: WorkflowCompileResult;
  sourceInfo: SourceInfo;
}

export interface FetchExternalErrors {
  fetch: string[]; //addresses
  compile: string[]; //addresses
  fetchers: string[]; //fetcher names
}

export interface Recognizer {
  getUnrecognizedAddresses(): string[];
  getAnUnrecognizedAddress(): string | undefined;
  addCompiledInfo(
    compileResult: WorkflowCompileResult,
    sourceInfo: SourceInfo,
    address: string,
    fetcherName: string
  ): void | Promise<void>;
  markUnrecognizable(address: string, reason?: FailureType): void;
  markBadFetcher(fetcherName: string): void;
}

//NOTE: this should really be defined by the debugger!
export interface Instances {
  [address: string]: {
    contractName?: string;
    source?: string;
    binary: string;
    constructorArgs?: string;
  };
}
