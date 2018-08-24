import { EVM as EVMUtils } from "./evm";
import { AstDefinition } from "../define/definition";

export namespace Definition {
  export function typeIdentifier(definition: AstDefinition) {
    return definition.typeDescriptions.typeIdentifier;
  }

  /**
   * returns basic type class for a variable definition node
   * e.g.:
   *  `t_uint256` becomes `uint`
   *  `t_struct$_Thing_$20_memory_ptr` becomes `struct`
   */
  export function typeClass(definition: AstDefinition) {
    return typeIdentifier(definition).match(/t_([^$_0-9]+)/)[1];
  }


  /**
   * e.g. uint48 -> 6
   * @return size in bytes for explicit type size, or `null` if not stated
   */
  export function specifiedSize(definition: AstDefinition) {
    let specified = typeIdentifier(definition).match(/t_[a-z]+([0-9]+)/);

    if (!specified) {
      return null;
    }

    let num = parseInt(specified[1]);

    switch (typeClass(definition)) {
      case "int":
      case "uint":
        return num / 8;

      case "bytes":
        return num;

      default:
        // debug("Unknown type for size specification: %s", typeIdentifier(definition));
    }
  }

  export function storageSize(definition: AstDefinition) {
    switch (typeClass(definition)) {
      case "bool":
        return 1;

      case "address":
        return 20;

      case "int":
      case "uint":
        return parseInt(typeIdentifier(definition).match(/t_[a-z]+([0-9]+)/)[1]) / 8;

      case "string":
      case "bytes":
      case "array":
        return EVMUtils.WORD_SIZE;

      case "mapping":
        // HACK just to reserve slot. mappings have no size as such
        return EVMUtils.WORD_SIZE;
    }
  }

  export function isMapping(definition: AstDefinition) {
    return typeIdentifier(definition).match(/^t_mapping/) != null;
  }

  export function isReference(definition: AstDefinition) {
    return typeIdentifier(definition).match(/_(memory|storage)(_ptr)?$/) != null;
  }

  export function referenceType(definition: AstDefinition) {
    return typeIdentifier(definition).match(/_([^_]+)(_ptr)?$/)[1];
  }

  export function baseDefinition(definition: AstDefinition) {
    let baseIdentifier = typeIdentifier(definition)
      // first dollar sign     last dollar sign
      //   `---------.       ,---'
      .match(/^[^$]+\$_(.+)_\$[^$]+$/)[1]
      //              `----' greedy match

    // HACK - internal types for memory or storage also seem to be pointers
    if (baseIdentifier.match(/_(memory|storage)$/) != null) {
      baseIdentifier = `${baseIdentifier}_ptr`;
    }

    // another HACK - we get away with it becausewe're only using that one property
    return {
      typeDescriptions: {
        typeIdentifier: baseIdentifier
      }
    };
  }
}