import { ContractObject } from "@truffle/contract-schema/spec";

export type Compilation = {
  sourceIndexes: string[];
  contracts: CompiledContract[];
  compiler: {
    name: string | undefined;
    version: string | undefined;
  };
};

export interface CompilerResult {
  compilations: Compilation[];
}

export interface Bytecode {
  bytes: string;
  linkReferences: LinkReference[];
}

export interface LinkReference {
  offsets: number[];
  name: string | null; // this will be the contractName of the library or some other identifier
  length: number;
}

export type CompiledContract = {
  contractName: string;
  sourcePath: string;
  source: string;
  sourceMap: string;
  deployedSourceMap: string;
  legacyAST: object;
  ast: object;
  abi: object[];
  metadata: string;
  bytecode: Bytecode;
  deployedBytecode: Bytecode;
  compiler: {
    name: string;
    version: string;
  };
  devdoc: object;
  userdoc: object;
  immutableReferences: object;
  generatedSources: any;
  deployedGeneratedSources: any;
};

export interface WorkflowCompileResult {
  compilations: Compilation[];
  contracts: CompiledContract[];
}

export type CompileFunction = ({
  sources,
  options
}: {
  sources: object;
  options: object;
}) => Promise<CompilerResult>;

export interface Compiler {
  all: (options: object) => Promise<CompilerResult>;
  necessary: (options: object) => Promise<CompilerResult>;
}
