import debugModule from "debug";
const debug = debugModule("codec:decode:constant");

import * as CodecUtils from "@truffle/codec/utils";
import { Types, Values } from "@truffle/codec/format";
import read from "@truffle/codec/read";
import decodeValue from "./value";
import { Pointer, Evm, Request } from "@truffle/codec/types";
import { DecodingError } from "@truffle/codec/decode/errors";

export default function* decodeConstant(dataType: Types.Type, pointer: Pointer.ConstantDefinitionPointer, info: Evm.EvmInfo): Generator<Request.DecoderRequest, Values.Result, Uint8Array> {

  debug("pointer %o", pointer);

  //normally, we just dispatch to decodeValue.
  //for statically-sized bytes, however, we need to make a special case.
  //you see, decodeValue expects to find the bytes at the *beginning*
  //of the word, but readDefinition will put them at the *end* of the
  //word.  So we'll have to adjust things ourselves.

  if(dataType.typeClass === "bytes" && dataType.kind === "static") {
    let size = dataType.length;
    let word: Uint8Array;
    try {
      word = yield* read(pointer, info.state);
    }
    catch(error) {
      return {
        type: dataType,
        kind: "error" as const,
        error: (<DecodingError>error).error
      };
    }
    //not bothering to check padding; shouldn't be necessary
    let bytes = word.slice(CodecUtils.EVM.WORD_SIZE - size);
    return {
      type: dataType,
      kind: "value" as const,
      value: {
        asHex: CodecUtils.Conversion.toHexString(bytes)
      }
    }; //we'll skip including a raw value, as that would be meaningless
  }

  //otherwise, as mentioned, just dispatch to decodeValue
  debug("not a static bytes");
  return yield* decodeValue(dataType, pointer, info);
}
