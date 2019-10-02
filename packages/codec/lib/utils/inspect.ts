import debugModule from "debug";
const debug = debugModule("codec:format:inspect");

import util from "util";
import { Types, Values, Errors } from "@truffle/codec/format";
import { message } from "./errors";

//we'll need to write a typing for the options type ourself, it seems; just
//going to include the relevant properties here
export interface InspectOptions {
  stylize?: (toMaybeColor: string, style?: string) => string;
  colors: boolean;
  breakLength: number;
}

//HACK -- inspect options are ridiculous, I swear >_>
export function cleanStylize(options: InspectOptions) {
  return Object.assign({}, ...Object.entries(options).map(
    ([key,value]) =>
      key === "stylize"
        ? {}
        : {[key]: value}
  ));
}

export class ResultInspector {
  result: Values.Result;
  constructor(result: Values.Result) {
    this.result = result;
  }
  [util.inspect.custom](depth: number | null, options: InspectOptions): string {
    switch(this.result.kind) {
      case "value":
        switch(this.result.type.typeClass) {
          case "uint":
          case "int":
            return options.stylize((<Values.UintValue|Values.IntValue>this.result).value.asBN.toString(), "number");
          case "fixed":
          case "ufixed":
            //note: because this is just for display, we don't bother adjusting the magic values Big.NE or Big.PE;
            //we'll trust those to their defaults
            return options.stylize((<Values.FixedValue|Values.UfixedValue>this.result).value.asBig.toString(), "number");
          case "bool":
            return util.inspect((<Values.BoolValue>this.result).value.asBoolean, options);
          case "bytes":
            let hex = (<Values.BytesValue>this.result).value.asHex;
            switch(this.result.type.kind) {
              case "static":
                return options.stylize(hex, "number");
              case "dynamic":
                return options.stylize(`hex'${hex.slice(2)}'`, "string");
            }
          case "address":
            return options.stylize((<Values.AddressValue>this.result).value.asAddress, "number");
          case "string": {
            let coercedResult = <Values.StringValue> this.result;
            switch(coercedResult.value.kind) {
              case "valid":
                return util.inspect(coercedResult.value.asString, options);
              case "malformed":
                //note: this will turn malformed utf-8 into replacement characters (U+FFFD)
                //note we need to cut off the 0x prefix
                return util.inspect(Buffer.from(coercedResult.value.asHex.slice(2), 'hex').toString());
            }
          }
          case "array": {
            let coercedResult = <Values.ArrayValue> this.result;
            if(coercedResult.reference !== undefined) {
              return formatCircular(coercedResult.reference, options);
            }
            return util.inspect(
              coercedResult.value.map(
                element => new ResultInspector(element)
              ),
              options
            );
          }
          case "mapping":
            return util.inspect(
              new Map(
                (<Values.MappingValue>this.result).value.map(
                  ({key, value}) => [new ResultInspector(key), new ResultInspector(value)]
                )
              ),
              options
            );
          case "struct": {
            let coercedResult = <Values.StructValue> this.result;
            if(coercedResult.reference !== undefined) {
              return formatCircular(coercedResult.reference, options);
            }
            return util.inspect(
              Object.assign({}, ...coercedResult.value.map(
                ({name, value}) => ({[name]: new ResultInspector(value)})
              )),
              options
            );
          }
          case "magic":
            return util.inspect(
              Object.assign({}, ...Object.entries((<Values.MagicValue>this.result).value).map(
                ([key, value]) => ({[key]: new ResultInspector(value)})
              )),
              options
            )
          case "enum": {
            return enumFullName(<Values.EnumValue>this.result); //not stylized
          }
          case "contract": {
            return util.inspect(
              new ContractInfoInspector(
                (<Values.ContractValue>this.result).value
              ),
              options
            );
          }
          case "function":
            switch(this.result.type.visibility) {
              case "external": {
                let coercedResult = <Values.FunctionExternalValue> this.result;
                let contractString = util.inspect(
                  new ContractInfoInspector(
                    coercedResult.value.contract
                  ),
                  { ...cleanStylize(options), colors: false }
                );
                let firstLine: string;
                switch(coercedResult.value.kind) {
                  case "known":
                    firstLine = `[Function: ${coercedResult.value.abi.name} of`;
                    break;
                  case "invalid":
                  case "unknown":
                    firstLine = `[Function: Unknown selector ${coercedResult.value.selector} of`;
                    break;
                }
                let secondLine = `${contractString}]`;
                let breakingSpace = firstLine.length >= options.breakLength ? "\n" : " ";
                //now, put it together
                return options.stylize(firstLine + breakingSpace + secondLine, "special");
              }
              case "internal": {
                let coercedResult = <Values.FunctionInternalValue> this.result;
                switch(coercedResult.value.kind) {
                  case "function":
                    return options.stylize(
                      `[Function: ${coercedResult.value.definedIn.typeName}.${coercedResult.value.name}]`,
                      "special"
                    );
                  case "exception":
                    return coercedResult.value.deployedProgramCounter === 0
                      ? options.stylize(`[Function: <zero>]`, "special")
                      : options.stylize(`[Function: assert(false)]`, "special");
                  case "unknown":
                    let firstLine = `[Function: decoding not supported (raw info:`;
                    let secondLine = `deployed PC=${coercedResult.value.deployedProgramCounter}, constructor PC=${coercedResult.value.constructorProgramCounter})]`;
                    let breakingSpace = firstLine.length >= options.breakLength ? "\n" : " ";
                    //now, put it together
                    return options.stylize(firstLine + breakingSpace + secondLine, "special");
                }
              }
            }
        }
      case "error": {
        debug("this.result: %O", this.result);
        let errorResult = <Errors.ErrorResult> this.result; //the hell?? why couldn't it make this inference??
        switch(errorResult.error.kind) {
          case "UintPaddingError":
            return `Uint has extra leading bytes (padding error) (raw value ${errorResult.error.raw})`;
          case "IntPaddingError":
            return `Int out of range (padding error) (raw value ${errorResult.error.raw})`;
          case "UintPaddingError":
            return `Ufixed has extra leading bytes (padding error) (raw value ${errorResult.error.raw})`;
          case "FixedPaddingError":
            return `Fixed out of range (padding error) (raw value ${errorResult.error.raw})`;
          case "BoolOutOfRangeError":
            return `Invalid boolean (numeric value ${errorResult.error.rawAsBN.toString()})`;
          case "BytesPaddingError":
            return `Bytestring has extra trailing bytes (padding error) (raw value ${errorResult.error.raw})`;
          case "AddressPaddingError":
            return `Address has extra leading bytes (padding error) (raw value ${errorResult.error.raw})`;
          case "EnumOutOfRangeError":
            return `Invalid ${enumTypeName(errorResult.error.type)} (numeric value ${errorResult.error.rawAsBN.toString()})`;
          case "EnumNotFoundDecodingError":
            return `Unknown enum type ${enumTypeName(errorResult.error.type)} of id ${errorResult.error.type.id} (numeric value ${errorResult.error.rawAsBN.toString()})`;
          case "ContractPaddingError":
            return `Contract address has extra leading bytes (padding error) (raw value ${errorResult.error.raw})`;
          case "FunctionExternalNonStackPaddingError":
            return `External function has extra trailing bytes (padding error) (raw value ${errorResult.error.raw})`;
          case "FunctionExternalStackPaddingError":
            return `External function address or selector has extra leading bytes (padding error) (raw address ${errorResult.error.rawAddress}, raw selector ${errorResult.error.rawSelector})`;
          case "FunctionInternalPaddingError":
            return `Internal function has extra leading bytes (padding error) (raw value ${errorResult.error.raw})`;
          case "NoSuchInternalFunctionError":
            return `Invalid function (Deployed PC=${errorResult.error.deployedProgramCounter}, constructor PC=${errorResult.error.constructorProgramCounter}) of contract ${errorResult.error.context.typeName}`;
          case "DeployedFunctionInConstructorError":
            return `Deployed-style function (PC=${errorResult.error.deployedProgramCounter}) in constructor`;
          case "MalformedInternalFunctionError":
            return `Malformed internal function w/constructor PC only (value: ${errorResult.error.constructorProgramCounter})`;
          case "IndexedReferenceTypeError":
            return `Cannot decode indexed parameter of reference type ${errorResult.error.type.typeClass} (raw value ${errorResult.error.raw})`;
          case "OverlongArraysAndStringsNotImplementedError":
            return `Array or string is too long (length ${errorResult.error.lengthAsBN.toString()}); decoding is not supported`;
          case "OverlargePointersNotImplementedError":
            return `Pointer is too large (value ${errorResult.error.pointerAsBN.toString()}); decoding is not supported`;
          case "UserDefinedTypeNotFoundError":
          case "UnsupportedConstantError":
          case "ReadErrorStack":
          case "ReadErrorStorage":
          case "ReadErrorBytes":
            return message(errorResult.error); //yay, these five are already defined!
        }
      }
    }
  }
}

//these get their own class to deal with a minor complication
class ContractInfoInspector {
  value: Values.ContractValueInfo;
  constructor(value: Values.ContractValueInfo) {
    this.value = value;
  }
  [util.inspect.custom](depth: number | null, options: InspectOptions): string {
    switch(this.value.kind) {
      case "known":
        return options.stylize(this.value.address, "number") + ` (${this.value.class.typeName})`;
      case "unknown":
        return options.stylize(this.value.address, "number") + " of unknown class";
    }
  }
}

function enumTypeName(enumType: Types.EnumType) {
  return (enumType.kind === "local" ? (enumType.definingContractName + ".") : "") + enumType.typeName;
}

function styleHexString(hex: string, options: InspectOptions): string {
  return options.stylize(`hex'${hex.slice(2)}'`, "string");
}

//this function will be used in the future for displaying circular
//structures
function formatCircular(loopLength: number, options: InspectOptions): string {
  return options.stylize(`[Circular (=up ${this.loopLength})]`, "special");
}

export function enumFullName(value: Values.EnumValue): string {
  switch(value.type.kind) {
    case "local":
      return `${value.type.definingContractName}.${value.type.typeName}.${value.value.name}`;
    case "global":
      return `${value.type.typeName}.${value.value.name}`;
  }
}
