/**
 * Usage:
 *
 * ```
 * import { ... } from "@truffle/codec";
 * ```
 *
 * @module @truffle/codec
 */ /** */

require("source-map-support/register");

//So, what shall codec export...?

//First: export the data format
import * as Format from "@truffle/codec/format";
export {
  /**
   * Here's the decoder output format.
   * Most of this doesn't have explanatory documentation
   * because it's largely self-explanatory, but particularly
   * non-obvious parts have been documented for clarity.
   *
   * A note on optional fields: A number of types or values
   * have optional fields.  These contain helpful
   * but non-essential information, or information which
   * for technical reasons we can't guarantee we can determine.
   *
   * @category Data
   */
  Format
};

//now... various low-level stuff we want to export!
//the actual decoding functions and related errors
export { decodeVariable, decodeEvent, decodeCalldata } from "./core";
export { DecodingError, StopDecodingError } from "./decode/errors";

//and to read the stack
export { readStack } from "./read/stack";

//finally, let's export the low-level encoding functions, because why not, someone
//might want them :P
export { encodeAbi, encodeTupleAbi } from "./encode/abi";
export { encodeMappingKey } from "./encode/key";
//(actually we use at least one of these in tests atm so we'd better export!)

//now: what types should we export? (other than the ones from ./format)
//public-facing types for the interface
export * from "./types";
export * from "./common";

export * from "./abify";

//for those who want more low-level stuff...
import * as Abi from "./abi";
export { Abi };

import * as Ast from "./ast";
export { Ast };

import * as Compiler from "./compiler";
export { Compiler };

import * as Contexts from "./contexts";
export { Contexts };

import * as Conversion from "./conversion";
export { Conversion };

import * as Memory from "./memory";
export { Memory };

import * as Pointer from "./pointer";
export { Pointer };

import * as Evm from "./evm";
export { Evm };

import * as Storage from "./storage";
export { Storage };
