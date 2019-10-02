import debugModule from "debug";
const debug = debugModule("codec:decode:abi");

import BN from "bn.js";
import read from "@truffle/codec/read";
import * as CodecUtils from "@truffle/codec/utils";
import { TypeUtils } from "@truffle/codec/utils";
import { Types, Values, Errors } from "@truffle/codec/format";
import decodeValue from "./value";
import { AbiDataPointer, DataPointer } from "@truffle/codec/types/pointer";
import { AbiMemberAllocation } from "@truffle/codec/types/allocation";
import { abiSizeInfo } from "@truffle/codec/allocate/abi";
import { EvmInfo } from "@truffle/codec/types/evm";
import { DecoderOptions } from "@truffle/codec/types/options";
import { DecoderRequest } from "@truffle/codec/types/request";
import { DecodingError, StopDecodingError } from "@truffle/codec/decode/errors";

type AbiLocation = "calldata" | "eventdata"; //leaving out "abi" as it shouldn't occur here

export default function* decodeAbi(dataType: Types.Type, pointer: AbiDataPointer, info: EvmInfo, options: DecoderOptions = {}): Generator<DecoderRequest, Values.Result, Uint8Array> {
  if(TypeUtils.isReferenceType(dataType) || dataType.typeClass === "tuple") {
    //I don't want tuples to be considered a reference type, but it makes sense
    //to group them for this purpose
    let dynamic: boolean;
    try {
      dynamic = abiSizeInfo(dataType, info.allocations.abi).dynamic;
    }
    catch(error) {
      if(options.strictAbiMode) {
        throw new StopDecodingError((<DecodingError>error).error);
      }
      return <Errors.ErrorResult> { //dunno why TS is failing at this inference
        type: dataType,
        kind: "error" as const,
        error: (<DecodingError>error).error
      };
    }
    if(dynamic) {
      return yield* decodeAbiReferenceByAddress(dataType, pointer, info, options);
    }
    else {
      return yield* decodeAbiReferenceStatic(dataType, pointer, info, options);
    }
  }
  else {
    debug("pointer %o", pointer);
    return yield* decodeValue(dataType, pointer, info, options);
  }
}

export function* decodeAbiReferenceByAddress(dataType: Types.ReferenceType | Types.TupleType, pointer: DataPointer, info: EvmInfo, options: DecoderOptions = {}): Generator<DecoderRequest, Values.Result, Uint8Array> {
  let { strictAbiMode: strict, abiPointerBase: base } = options;
  base = base || 0; //in case base was undefined
  const { allocations: { abi: allocations }, state } = info;
  debug("pointer %o", pointer);
  //this variable holds the location we should look to *next*
  const location: AbiLocation = pointer.location === "eventdata"
    ? "eventdata"
    : "calldata"; //stack pointers (& stack literal pointers) point to calldata, not the stack

  let rawValue: Uint8Array;
  try {
    rawValue = yield* read(pointer, state);
  }
  catch(error) {
    if(strict) {
      throw new StopDecodingError((<DecodingError>error).error);
    }
    return <Errors.ErrorResult> { //dunno why TS is failing here
      type: dataType,
      kind: "error" as const,
      error: (<DecodingError>error).error
    };
  }

  let rawValueAsBN = CodecUtils.Conversion.toBN(rawValue);
  let rawValueAsNumber: number;
  try {
    rawValueAsNumber = rawValueAsBN.toNumber();
  }
  catch(_) {
    let error = {
      kind: "OverlargePointersNotImplementedError" as const,
      pointerAsBN: rawValueAsBN,
    };
    if(strict) {
      throw new StopDecodingError(error);
    }
    return <Errors.ErrorResult> { //again with the TS failures...
      type: dataType,
      kind: "error" as const,
      error
    }
  }
  let startPosition = rawValueAsNumber + base;
  debug("startPosition %d", startPosition);

  let dynamic: boolean;
  let size: number;
  try {
    ({dynamic, size} = abiSizeInfo(dataType, allocations));
  }
  catch(error) {
    if(strict) {
      throw new StopDecodingError((<DecodingError>error).error);
    }
    return <Errors.ErrorResult> { //dunno why TS is failing here
      type: dataType,
      kind: "error" as const,
      error: (<DecodingError>error).error
    };
  }
  if(!dynamic) { //this will only come up when called from stack.ts
    let staticPointer = {
      location,
      start: startPosition,
      length: size
    }
    return yield* decodeAbiReferenceStatic(dataType, staticPointer, info, options);
  }
  let length: number;
  let lengthAsBN: BN;
  let rawLength: Uint8Array;
  switch (dataType.typeClass) {

    case "bytes":
    case "string":
      //initial word contains length
      try {
        rawLength = yield* read({
          location,
          start: startPosition,
          length: CodecUtils.EVM.WORD_SIZE
        }, state);
      }
      catch(error) {
        if(strict) {
          throw new StopDecodingError((<DecodingError>error).error);
        }
        return <Errors.ErrorResult> { //dunno why TS is failing here
          type: dataType,
          kind: "error" as const,
          error: (<DecodingError>error).error
        };
      }
      lengthAsBN = CodecUtils.Conversion.toBN(rawLength);
      if(strict && lengthAsBN.gtn(state[location].length)) {
        //you may notice that the comparison is a bit crude; that's OK, this is
        //just to prevent huge numbers from DOSing us, other errors will still
        //be caught regardless
        throw new StopDecodingError(
          {
            kind: "OverlongArrayOrStringStrictModeError" as const,
            lengthAsBN,
            dataLength: state[location].length
          }
        );
      }
      try {
        length = lengthAsBN.toNumber();
      }
      catch(_) {
        //note: if we're in this situation, we can assume we're not in strict mode,
        //as the strict case was handled above
        return <Errors.BytesDynamicErrorResult|Errors.StringErrorResult> { //again with the TS failures...
          type: dataType,
          kind: "error" as const,
          error: {
            kind: "OverlongArraysAndStringsNotImplementedError" as const,
            lengthAsBN
          }
        };
      }

      let childPointer: AbiDataPointer = {
        location,
        start: startPosition + CodecUtils.EVM.WORD_SIZE,
        length
      }

      return yield* decodeValue(dataType, childPointer, info, options);

    case "array":

      switch(dataType.kind) {
        case "dynamic":
          //initial word contains array length
          try {
            rawLength = yield* read({
              location,
              start: startPosition,
              length: CodecUtils.EVM.WORD_SIZE
            }, state);
          }
          catch(error) { //error: DecodingError
            if(strict) {
              throw new StopDecodingError((<DecodingError>error).error);
            }
            return {
              type: dataType,
              kind: "error" as const,
              error: (<DecodingError>error).error
            };
          }
          lengthAsBN = CodecUtils.Conversion.toBN(rawLength);
          startPosition += CodecUtils.EVM.WORD_SIZE; //increment startPosition
          //to next word, as first word was used for length
          break;
        case "static":
          lengthAsBN = dataType.length;
          break;
      }
      if(strict && lengthAsBN.gtn(state[location].length)) {
        //you may notice that the comparison is a bit crude; that's OK, this is
        //just to prevent huge numbers from DOSing us, other errors will still
        //be caught regardless
        throw new StopDecodingError(
          {
            kind: "OverlongArraysAndStringsNotImplementedError" as const,
            lengthAsBN,
            dataLength: state[location].length
          }
        );
      }
      try {
        length = lengthAsBN.toNumber();
      }
      catch(_) {
        //again, if we get here, we can assume we're not in strict mode
        return {
          type: dataType,
          kind: "error" as const,
          error: {
            kind: "OverlongArraysAndStringsNotImplementedError" as const,
            lengthAsBN
          }
        };
      }

      //note: I've written this fairly generically, but it is worth noting that
      //since this array is of dynamic type, we know that if it's static length
      //then size must be EVM.WORD_SIZE

      let baseSize: number;
      try {
        baseSize = abiSizeInfo(dataType.baseType, allocations).size;
      }
      catch(error) {
        if(strict) {
          throw new StopDecodingError((<DecodingError>error).error);
        }
        return {
          type: dataType,
          kind: "error" as const,
          error: (<DecodingError>error).error
        };
      }

      let decodedChildren: Values.Result[] = [];
      for(let index = 0; index < length; index++) {
        decodedChildren.push(
          yield* decodeAbi(
            dataType.baseType,
            {
              location,
              start: startPosition + index * baseSize,
              length: baseSize
            },
            info, { ...options, abiPointerBase: startPosition }
          )
        ); //pointer base is always start of list, never the length
      }
      return {
        type: dataType,
        kind: "value" as const,
        value: decodedChildren
      };

    case "struct":
      return yield* decodeAbiStructByPosition(dataType, location, startPosition, info, options);
    case "tuple":
      return yield* decodeAbiTupleByPosition(dataType, location, startPosition, info, options);
  }
}

export function* decodeAbiReferenceStatic(dataType: Types.ReferenceType | Types.TupleType, pointer: AbiDataPointer, info: EvmInfo, options: DecoderOptions = {}): Generator<DecoderRequest, Values.Result, Uint8Array> {
  debug("static");
  debug("pointer %o", pointer);
  const location = pointer.location;

  switch (dataType.typeClass) {
    case "array":

      //we're in the static case, so we know the array must be statically sized
      const lengthAsBN = (<Types.ArrayTypeStatic>dataType).length;
      let length: number;
      try {
        length = lengthAsBN.toNumber();
      }
      catch(_) {
        //note: since this is the static case, we don't bother including the stronger
        //strict-mode guard against getting DOSed by large array sizes, since in this
        //case we're not reading the size from the input; if there's a huge static size
        //array, well, we'll just have to deal with it
        let error = {
          kind: "OverlongArraysAndStringsNotImplementedError" as const,
          lengthAsBN
        };
        if(options.strictAbiMode) {
          throw new StopDecodingError(error);
        }
        return {
          type: dataType,
          kind: "error" as const,
          error
        }
      }
      let baseSize: number;
      try {
        baseSize = abiSizeInfo(dataType.baseType, info.allocations.abi).size;
      }
      catch(error) { //error: DecodingError
        if(options.strictAbiMode) {
          throw new StopDecodingError((<DecodingError>error).error);
        }
        return {
          type: dataType,
          kind: "error" as const,
          error: (<DecodingError>error).error
        };
      }

      let decodedChildren: Values.Result[] = [];
      for(let index = 0; index < length; index++) {
        decodedChildren.push(
          yield* decodeAbi(
            dataType.baseType,
            {
              location,
              start: pointer.start + index * baseSize,
              length: baseSize
            },
            info, options
          )
        );
      }
      return {
        type: dataType,
        kind: "value" as const,
        value: decodedChildren
      };

    case "struct":
      return yield* decodeAbiStructByPosition(dataType, location, pointer.start, info, options);
    case "tuple":
      return yield* decodeAbiTupleByPosition(dataType, location, pointer.start, info, options);
  }
}

//note that this function takes the start position as a *number*; it does not take a pointer
function* decodeAbiStructByPosition(dataType: Types.StructType, location: AbiLocation, startPosition: number, info: EvmInfo, options: DecoderOptions = {}): Generator<DecoderRequest, Values.StructResult, Uint8Array> {
  const { userDefinedTypes, allocations: { abi: allocations } } = info;

  const typeLocation = location === "eventdata"
    ? null //eventdata is not a valid location for a type
    : location;

  const typeId = dataType.id;
  const structAllocation = allocations[parseInt(typeId)];
  if(!structAllocation) {
    let error = {
      kind: "UserDefinedTypeNotFoundError" as const,
      type: dataType
    };
    if(options.strictAbiMode || options.allowRetry) {
      throw new StopDecodingError(error, true);
      //note that we allow a retry if we couldn't locate the allocation!
    }
    return {
      type: dataType,
      kind: "error" as const,
      error
    };
  }

  let decodedMembers: Values.NameValuePair[] = [];
  for(let index = 0; index < structAllocation.members.length; index++) {
    const memberAllocation = structAllocation.members[index];
    const memberPointer = memberAllocation.pointer;
    const childPointer: AbiDataPointer = {
      location,
      start: startPosition + memberPointer.start,
      length: memberPointer.length
    };

    let memberName = memberAllocation.name;
    let storedType = <Types.StructType>userDefinedTypes[typeId];
    if(!storedType) {
      let error = {
        kind: "UserDefinedTypeNotFoundError" as const,
        type: dataType
      };
      if(options.strictAbiMode || options.allowRetry) {
        throw new StopDecodingError(error, true);
        //similarly we allow a retry if we couldn't locate the type
      }
      return {
        type: dataType,
        kind: "error" as const,
        error
      };
    }
    let storedMemberType = storedType.memberTypes[index].type;
    let memberType = TypeUtils.specifyLocation(storedMemberType, typeLocation);

    decodedMembers.push({
      name: memberName,
      value: yield* decodeAbi(memberType, childPointer, info, {...options, abiPointerBase: startPosition})
      //note that the base option is only needed in the dynamic case, but we're being indiscriminate
    });
  }
  return {
    type: dataType,
    kind: "value" as const,
    value: decodedMembers
  };
}

//note that this function takes the start position as a *number*; it does not take a pointer
function* decodeAbiTupleByPosition(dataType: Types.TupleType, location: AbiLocation, startPosition: number, info: EvmInfo, options: DecoderOptions = {}): Generator<DecoderRequest, Values.TupleResult, Uint8Array> {
  //WARNING: This case is written in a way that involves a bunch of unnecessary recomputation!
  //I'm writing it this way anyway for simplicity, to avoid rewriting the decoder
  //However it may be worth revisiting this in the future if performance turns out to be a problem
  //(changing this may be pretty hard though)

  let decodedMembers: Values.NameValuePair[] = [];
  let position = startPosition;
  for(const { name, type: memberType } of dataType.memberTypes) {
    const memberSize = abiSizeInfo(memberType, info.allocations.abi).size;
    const childPointer: AbiDataPointer = {
      location,
      start: position,
      length: memberSize
    };
    decodedMembers.push({
      name,
      value: yield* decodeAbi(memberType, childPointer, info, {...options, abiPointerBase: startPosition})
      //note that the base option is only needed in the dynamic case, but we're being indiscriminate
    });
    position += memberSize;
  }
  return {
    type: dataType,
    kind: "value" as const,
    value: decodedMembers
  };
}
