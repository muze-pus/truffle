import debugModule from "debug";
const debug = debugModule("codec:format:utils:maketype");

import BN from "bn.js";
import * as Common from "@truffle/codec/common";
import * as Compiler from "@truffle/codec/compiler";
import * as AbiData from "@truffle/codec/abi-data/types";
import * as Ast from "@truffle/codec/ast";
import * as Format from "@truffle/codec/format/common";

//NOTE: the following function will *not* work for arbitrary nodes! It will,
//however, work for the ones we need (i.e., variable definitions, and arbitrary
//things of elementary type)
//NOTE: set forceLocation to *null* to force no location. leave it undefined
//to not force a location.
export function definitionToType(
  definition: Ast.AstNode,
  compiler: Compiler.CompilerVersion,
  forceLocation?: Common.Location | null
): Format.Types.Type {
  debug("definition %O", definition);
  let typeClass = Ast.Utils.typeClass(definition);
  let typeHint = Ast.Utils.typeStringWithoutLocation(definition);
  switch (typeClass) {
    case "bool":
      return {
        typeClass,
        typeHint
      };
    case "address": {
      switch (Compiler.Utils.solidityFamily(compiler)) {
        case "pre-0.5.0":
          return {
            typeClass,
            kind: "general",
            typeHint
          };
        case "0.5.x":
          return {
            typeClass,
            kind: "specific",
            payable:
              Ast.Utils.typeIdentifier(definition) === "t_address_payable"
          };
      }
      break; //to satisfy typescript
    }
    case "uint": {
      let bytes = Ast.Utils.specifiedSize(definition);
      return {
        typeClass,
        bits: bytes * 8,
        typeHint
      };
    }
    case "int": {
      //typeScript won't let me group these for some reason
      let bytes = Ast.Utils.specifiedSize(definition);
      return {
        typeClass,
        bits: bytes * 8,
        typeHint
      };
    }
    case "fixed": {
      //typeScript won't let me group these for some reason
      let bytes = Ast.Utils.specifiedSize(definition);
      let places = Ast.Utils.decimalPlaces(definition);
      return {
        typeClass,
        bits: bytes * 8,
        places,
        typeHint
      };
    }
    case "ufixed": {
      let bytes = Ast.Utils.specifiedSize(definition);
      let places = Ast.Utils.decimalPlaces(definition);
      return {
        typeClass,
        bits: bytes * 8,
        places,
        typeHint
      };
    }
    case "string": {
      if (forceLocation === null) {
        return {
          typeClass,
          typeHint
        };
      }
      let location = forceLocation || Ast.Utils.referenceType(definition);
      return {
        typeClass,
        location,
        typeHint
      };
    }
    case "bytes": {
      let length = Ast.Utils.specifiedSize(definition);
      if (length !== null) {
        return {
          typeClass,
          kind: "static",
          length,
          typeHint
        };
      } else {
        if (forceLocation === null) {
          return {
            typeClass,
            kind: "dynamic",
            typeHint
          };
        }
        let location = forceLocation || Ast.Utils.referenceType(definition);
        return {
          typeClass,
          kind: "dynamic",
          location,
          typeHint
        };
      }
    }
    case "array": {
      let baseDefinition = Ast.Utils.baseDefinition(definition);
      let baseType = definitionToType(baseDefinition, compiler, forceLocation);
      let location = forceLocation || Ast.Utils.referenceType(definition);
      if (Ast.Utils.isDynamicArray(definition)) {
        if (forceLocation !== null) {
          return {
            typeClass,
            baseType,
            kind: "dynamic",
            location,
            typeHint
          };
        } else {
          return {
            typeClass,
            baseType,
            kind: "dynamic",
            typeHint
          };
        }
      } else {
        let length = new BN(Ast.Utils.staticLengthAsString(definition));
        if (forceLocation !== null) {
          return {
            typeClass,
            baseType,
            kind: "static",
            length,
            location,
            typeHint
          };
        } else {
          return {
            typeClass,
            baseType,
            kind: "static",
            length,
            typeHint
          };
        }
      }
    }
    case "mapping": {
      let keyDefinition = Ast.Utils.keyDefinition(definition);
      //note that we can skip the scopes argument here! that's only needed when
      //a general node, rather than a declaration, is being passed in
      let keyType = <Format.Types.ElementaryType>(
        definitionToType(keyDefinition, compiler, null)
      );
      //suppress the location on the key type (it'll be given as memory but
      //this is meaningless)
      //also, we have to tell TypeScript ourselves that this will be an elementary
      //type; it has no way of knowing that
      let valueDefinition =
        definition.valueType || definition.typeName.valueType;
      let valueType = definitionToType(
        valueDefinition,
        compiler,
        forceLocation
      );
      if (forceLocation === null) {
        return {
          typeClass,
          keyType,
          valueType
        };
      }
      return {
        typeClass,
        keyType,
        valueType,
        location: "storage"
      };
    }
    case "function": {
      let visibility = Ast.Utils.visibility(definition);
      let mutability = Ast.Utils.mutability(definition);
      let [inputParameters, outputParameters] = Ast.Utils.parameters(
        definition
      );
      //note: don't force a location on these! use the listed location!
      let inputParameterTypes = inputParameters.map(parameter =>
        definitionToType(parameter, compiler)
      );
      let outputParameterTypes = outputParameters.map(parameter =>
        definitionToType(parameter, compiler)
      );
      switch (visibility) {
        case "internal":
          return {
            typeClass,
            visibility,
            mutability,
            inputParameterTypes,
            outputParameterTypes
          };
        case "external":
          return {
            typeClass,
            visibility,
            kind: "specific",
            mutability,
            inputParameterTypes,
            outputParameterTypes
          };
      }
      break; //to satisfy typescript
    }
    case "struct": {
      let id = Ast.Utils.typeId(definition).toString();
      let qualifiedName = Ast.Utils.typeStringWithoutLocation(definition).match(
        /struct (.*)/
      )[1];
      let [definingContractName, typeName] = qualifiedName.split(".");
      if (forceLocation === null) {
        return {
          typeClass,
          kind: "local",
          id,
          typeName,
          definingContractName
        };
      }
      let location = forceLocation || Ast.Utils.referenceType(definition);
      return {
        typeClass,
        kind: "local",
        id,
        typeName,
        definingContractName,
        location
      };
    }
    case "enum": {
      let id = Ast.Utils.typeId(definition).toString();
      let qualifiedName = Ast.Utils.typeStringWithoutLocation(definition).match(
        /enum (.*)/
      )[1];
      let [definingContractName, typeName] = qualifiedName.split(".");
      return {
        typeClass,
        kind: "local",
        id,
        typeName,
        definingContractName
      };
    }
    case "contract": {
      let id = Ast.Utils.typeId(definition).toString();
      let typeName = definition.typeName
        ? definition.typeName.name
        : definition.name;
      let contractKind = Ast.Utils.contractKind(definition);
      return {
        typeClass,
        kind: "native",
        id,
        typeName,
        contractKind
      };
    }
    case "magic": {
      let typeIdentifier = Ast.Utils.typeIdentifier(definition);
      let variable = <Format.Types.MagicVariableName>(
        typeIdentifier.match(/^t_magic_(.*)$/)[1]
      );
      return {
        typeClass,
        variable
      };
    }
  }
}

//whereas the above takes variable definitions, this takes the actual type
//definition
export function definitionToStoredType(
  definition: Ast.AstNode,
  compiler: Compiler.CompilerVersion,
  referenceDeclarations?: Ast.AstNodes
): Format.Types.UserDefinedType {
  switch (definition.nodeType) {
    case "StructDefinition": {
      let id = definition.id.toString();
      let [definingContractName, typeName] = definition.canonicalName.split(
        "."
      );
      let memberTypes: {
        name: string;
        type: Format.Types.Type;
      }[] = definition.members.map(member => ({
        name: member.name,
        type: definitionToType(member, compiler, null)
      }));
      let definingContract;
      if (referenceDeclarations) {
        let contractDefinition = Object.values(referenceDeclarations).find(
          node =>
            node.nodeType === "ContractDefinition" &&
            node.nodes.some(
              (subNode: Ast.AstNode) => subNode.id.toString() === id
            )
        );
        definingContract = <Format.Types.ContractTypeNative>(
          definitionToStoredType(contractDefinition, compiler)
        ); //can skip reference declarations
      }
      return {
        typeClass: "struct",
        kind: "local",
        id,
        typeName,
        definingContractName,
        definingContract,
        memberTypes
      };
    }
    case "EnumDefinition": {
      let id = definition.id.toString();
      let [definingContractName, typeName] = definition.canonicalName.split(
        "."
      );
      let options = definition.members.map(member => member.name);
      let definingContract;
      if (referenceDeclarations) {
        let contractDefinition = Object.values(referenceDeclarations).find(
          node =>
            node.nodeType === "ContractDefinition" &&
            node.nodes.some(
              (subNode: Ast.AstNode) => subNode.id.toString() === id
            )
        );
        definingContract = <Format.Types.ContractTypeNative>(
          definitionToStoredType(contractDefinition, compiler)
        ); //can skip reference declarations
      }
      return {
        typeClass: "enum",
        kind: "local",
        id,
        typeName,
        definingContractName,
        definingContract,
        options
      };
    }
    case "ContractDefinition": {
      let id = definition.id.toString();
      let typeName = definition.name;
      let contractKind = definition.contractKind;
      let payable = Ast.Utils.isContractPayable(definition);
      return {
        typeClass: "contract",
        kind: "native",
        id,
        typeName,
        contractKind,
        payable
      };
    }
  }
}

export function abiParameterToType(
  abi: AbiData.AbiParameter
): Format.Types.Type {
  let typeName = abi.type;
  let typeHint = abi.internalType;
  //first: is it an array?
  let arrayMatch = typeName.match(/(.*)\[(\d*)\]$/);
  if (arrayMatch) {
    let baseTypeName = arrayMatch[1];
    let lengthAsString = arrayMatch[2]; //may be empty!
    let baseAbi = { ...abi, type: baseTypeName };
    let baseType = abiParameterToType(baseAbi);
    if (lengthAsString === "") {
      return {
        typeClass: "array",
        kind: "dynamic",
        baseType,
        typeHint
      };
    } else {
      let length = new BN(lengthAsString);
      return {
        typeClass: "array",
        kind: "static",
        length,
        baseType,
        typeHint
      };
    }
  }
  //otherwise, here are the simple cases
  let typeClass = typeName.match(/^([^0-9]+)/)[1];
  switch (typeClass) {
    case "uint":
    case "int": {
      let bits = typeName.match(/^u?int([0-9]+)/)[1];
      return {
        typeClass,
        bits: parseInt(bits),
        typeHint
      };
    }
    case "bytes":
      let length = typeName.match(/^bytes([0-9]*)/)[1];
      if (length === "") {
        return {
          typeClass,
          kind: "dynamic",
          typeHint
        };
      } else {
        return {
          typeClass,
          kind: "static",
          length: parseInt(length),
          typeHint
        };
      }
    case "address":
      return {
        typeClass,
        kind: "general",
        typeHint
      };
    case "string":
    case "bool":
      return {
        typeClass,
        typeHint
      };
    case "fixed":
    case "ufixed": {
      let [_, bits, places] = typeName.match(/^u?fixed([0-9]+)x([0-9]+)/);
      return {
        typeClass,
        bits: parseInt(bits),
        places: parseInt(places),
        typeHint
      };
    }
    case "function":
      return {
        typeClass,
        visibility: "external",
        kind: "general",
        typeHint
      };
    case "tuple":
      let memberTypes = abi.components.map(component => ({
        name: component.name || undefined, //leave undefined if component.name is empty string
        type: abiParameterToType(component)
      }));
      return {
        typeClass,
        memberTypes,
        typeHint
      };
  }
}
