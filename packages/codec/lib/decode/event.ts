import debugModule from "debug";
const debug = debugModule("codec:decode:event");

import decodeValue from "./value";
import read from "@truffle/codec/read";
import { Types, Values, Errors } from "@truffle/codec/format";
import { Conversion as ConversionUtils, TypeUtils } from "@truffle/codec/utils";
import { Pointer, Options } from "@truffle/codec/types";
import * as Decoding from "./types";
import * as Evm from "@truffle/codec/evm";

export default function* decodeTopic(dataType: Types.Type, pointer: Pointer.EventTopicPointer, info: Evm.Types.EvmInfo, options: Options.DecoderOptions = {}): Generator<Decoding.DecoderRequest, Values.Result, Uint8Array> {
  if(TypeUtils.isReferenceType(dataType)) {
    //we cannot decode reference types "stored" in topics; we have to just return an error
    let bytes: Uint8Array = yield* read(pointer, info.state);
    let raw: string = ConversionUtils.toHexString(bytes);
    //NOTE: even in strict mode we want to just return this, not throw an error here
    return <Errors.ErrorResult> { //dunno why TS is failing here
      type: dataType,
      kind: "error" as const,
      error: {
	kind: "IndexedReferenceTypeError" as const,
        type: dataType,
        raw
      }
    };
  }
  //otherwise, dispatch to decodeValue
  return yield* decodeValue(dataType, pointer, info, options);
}
