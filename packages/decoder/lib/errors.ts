import type BN from "bn.js";
import { Format } from "@truffle/codec";

/**
 * This error indicates that the contract you are attempting to decode does not have AST
 * information associated with it, or that the decoder cannot find it.  This error will
 * be thrown if you attempt to use functions that require AST information with such a contract.
 * @category Exception
 */
export class ContractBeingDecodedHasNoNodeError extends Error {
  public contractName: string;
  public compilationId: string;
  constructor(contractName: string, compilationId: string) {
    const message = `Contract ${contractName} does not appear to have been compiled with Solidity (cannot locate contract node)`;
    super(message);
    this.contractName = contractName;
    this.compilationId = compilationId;
    this.name = "ContractBeingDecodedHasNoNodeError";
  }
}

/**
 * This error indicates that the contract you are attempting to decode could not be found in
 * the project info.  This error will be thrown if you attempt to spawn a contract decoder or
 * contract instance decoder for a contract not appearing in the project info.
 * @category Exception
 */
export class ContractNotFoundError extends Error {
  public contractName: string;
  public bytecode: string;
  public deployedBytecode: string;
  public address: string;
  constructor(
    contractName: string,
    bytecode: string,
    deployedBytecode: string,
    address: string
  ) {
    let message;
    if (contractName) {
      message = `Contract ${contractName} could not be found in the project information`;
    } else {
      message = `Contract at ${address} could not be found in the project information`;
    }
    super(message);
    this.contractName = contractName;
    this.bytecode = bytecode;
    this.deployedBytecode = deployedBytecode;
    this.address = address;
    this.name = "ContractNotFoundError";
  }
}

/**
 * This error indicates that something went wrong while attempting to determine the location
 * of this contract's state variables.  This error will be thrown if you attempt to use
 * decoding functions after something went wrong during setup.  Unfortunately, we can't
 * always avoid this at the moment; we're hoping to make this more robust in the future
 * with Truffle DB.  In the meantime, it is at least worth noting that you should not encounter
 * this error if your entire project was written in Solidity and all compiled at once.  Sorry.
 * @category Exception
 */
export class ContractAllocationFailedError extends Error {
  public id: number;
  public contractName: string;
  public compilationId: string;
  constructor(id: number, contractName: string, compilationId: string) {
    super(
      `No allocation found for contract ID ${id} (${contractName}) in compilation ${compilationId}`
    );
    this.id = id;
    this.contractName = contractName;
    this.compilationId = compilationId;
    this.name = "ContractAllocationFailedError";
  }
}

/**
 * This error indicates that an invalid address was passed to one of the
 * contract instance decoder spawners ([[forContractInstance]], etc).  Valid
 * addresses are those that Web3 accepts; i.e., either those with correct
 * checksums, or those that are all-lowercase or all-uppercase to deliberately
 * circumvent the checksum.
 * @category Exception
 */
export class InvalidAddressError extends Error {
  public address: string;
  constructor(address: string) {
    super(`Invalid address ${address}`);
    this.address = address;
    this.name = "InvalidAddressError";
  }
}

/**
 * This error indicates that the user requested a variable that does not exist.
 * @category Exception
 */
export class VariableNotFoundError extends Error {
  public nameOrId: string | number;
  constructor(nameOrId: string | number) {
    super(`No such variable ${nameOrId}`);
    this.nameOrId = nameOrId;
    this.name = "VariableNotFoundError";
  }
}

/**
 * This error indicates that the user requested a struct member that does not
 * exist.
 * @category Exception
 */
export class MemberNotFoundError extends Error {
  public memberName: string;
  public structType: Format.Types.StructType;
  public variable: string | number;
  public indices: any[];
  constructor(
    memberName: string,
    structType: Format.Types.StructType,
    variable: string | number,
    indices: any[]
  ) {
    const message = `Member ${memberName} does not exist on struct type ${Format.Types.typeStringWithoutLocation(
      structType
    )} in attempting to access variable ${variable}$, indexSequence ${indices.join(
      ", "
    )}`;
    super(message);
    this.memberName = memberName;
    this.structType = structType;
    this.variable = variable;
    this.indices = indices;
    this.name = "MemberNotFoundError";
  }
}

/**
 * This error indicates that the user requested an array index that is out
 * of bounds.  Note that currently this error is only thrown when an index
 * is requested that is outside *static* bounds; dynamic array bounds are
 * currently not checked.
 * @category Exception
 */
export class ArrayIndexOutOfBoundsError extends Error {
  public index: BN;
  public length: BN;
  public variable: string | number;
  public indices: any[];
  constructor(
    index: BN,
    length: BN,
    variable: string | number,
    indices: any[]
  ) {
    const message = `Index ${index} is out of bounds for array of length ${length} in attempting to access variable ${variable}, index sequence ${indices.join(
      ", "
    )}`;
    super(message);
    this.index = index.clone();
    this.length = length.clone();
    this.variable = variable;
    this.indices = indices;
    this.name = "ArrayIndexOutOfBoundsError";
  }
}

/**
 * This error indicates that no provider was passed to the decoder.
 */
export class NoProviderError extends Error {
  constructor() {
    super("No provider was given for the decoder to use.");
    this.name = "NoProviderError";
  }
}
