import * as Compiler from "@truffle/codec/compiler";
import * as Ast from "@truffle/codec/ast";
import { Abi as SchemaAbi } from "@truffle/contract-schema/spec";

//Note to other people passing in compilations:
//Please include all fields you can that aren't
//labeled compatibility hacks.  Those ones are only
//really meant for when I shim up a fake one of these.

/**
 * An individual compilation.
 */
export interface Compilation {
  /**
   * The compilation's ID.
   */
  id: string;
  /**
   * This field is a compatibility hack only intended for internal use.
   */
  unreliableSourceOrder?: boolean; //compatibility hack!
  /**
   * A list of sources involved in the compilation.
   */
  sources: Source[];
  /**
   * A list of contracts involved in the compilation.
   */
  contracts: Contract[];
  /**
   * The compiler used in the compilation.  For internal compatibility
   * purposes, this may technically be left out if the compiler is instead
   * specified on each source and contract, but please don't actually do that.
   */
  compiler?: Compiler.CompilerVersion;
}

/**
 * Represents a source in a compilation.
 */
export interface Source {
  /**
   * The source's ID.  For internal compatibility purposes, this may technically
   * be left out, but please include it.
   */
  id?: string;
  /**
   * The source's file path.
   */
  sourcePath?: string;
  /**
   * The source text.
   */
  source?: string;
  /**
   * The source's abstract syntax tree.
   */
  ast?: Ast.AstNode;
  /**
   * This field is a compatibility hack only inteded for internal use.
   * (It allows the compiler to be set on a source if none is set on the
   * compilation as a whole; please don't do that.)
   */
  compiler?: Compiler.CompilerVersion; //compatibility hack!
}

/**
 * Represents a contract in a compilation.
 */
export interface Contract {
  /**
   * The contract's name.
   */
  contractName: string;
  /**
   * The contract's constructor bytecode; may be given either as a string
   * in the old artifacts format, or as a bytecode object in the new
   * compilation format.
   */
  bytecode?: string | Bytecode;
  /**
   * The contract's deployed bytecode; may be given either as a string
   * in the old artifacts format, or as a bytecode object in the new
   * compilation format.
   */
  deployedBytecode?: string | Bytecode;
  /**
   * The contract's constructor source map.
   */
  sourceMap?: string;
  /**
   * The contract's deployed source map.
   */
  deployedSourceMap?: string;
  /**
   * The contract's ABI.
   */
  abi: SchemaAbi;
  /**
   * This field is a compatibility hack only inteded for internal use.
   * (It allows the compiler to be set on a source if none is set on the
   * compilation as a whole; please don't do that.)
   */
  compiler?: Compiler.CompilerVersion; //compatibility hack!
  /**
   * The ID of the contract's primary source.
   */
  primarySourceId?: string;
  /**
   * This field is a compatibility hack only inteded for internal use.
   * (It allows the primary source to be specified by array index rather than
   * by ID, but please don't actually do that.)
   */
  primarySourceIndex?: number; //compatibility hack!
}

//defining this ourselves for now, sorry!
export interface Bytecode {
  bytes: string;
  linkReferences: {
    offsets: number[];
    name: string;
    length: number;
  }[];
}
