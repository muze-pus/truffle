import { EvmVariableReferenceMapping, AstReferences, ContractMapping, getContractNode, ContractStateVariable } from "../interface/contract-decoder";
import { ContractObject } from "truffle-contract-schema/spec";
import { StoragePointer } from "../types/pointer";
import merge from "lodash.merge";
import cloneDeep from "lodash.clonedeep";
import * as DecodeUtils from "truffle-decode-utils";
import BN from "bn.js";

interface SlotAllocation {
  offset: BN;
  index: number;
};

export interface ContractStateInfo {
  variables: EvmVariableReferenceMapping;
  slot: SlotAllocation;
}

function getDeclarationsForTypes(contracts: ContractObject[], types: string[]): AstReferences {
  let result: AstReferences = {};

  for (let i = 0; i < contracts.length; i++) {
    const contract = contracts[i];
    const contractNode = getContractNode(contract);
    if (contractNode) {
      for (let k = 0; k < contractNode.nodes.length; k++) {
        const node = contractNode.nodes[k];
        if (types.indexOf(node.nodeType) >= 0) {
          result[node.id] = node;
        }
      }
    }
  }

  return result;
}

export function getReferenceDeclarations(contracts: ContractObject[]): [AstReferences, EvmVariableReferenceMapping] {
  let result: EvmVariableReferenceMapping = {};
  const types = [
    "EnumDefinition",
    "StructDefinition"
  ];

  const referenceDeclarations = getDeclarationsForTypes(contracts, types);

  Object.entries(referenceDeclarations).forEach((entry) => {
    const id = parseInt(entry[0]);
    const definition: DecodeUtils.AstDefinition = entry[1];

    result[id] = <ContractStateVariable>{
      definition: definition,
      isChildVariable: false
    };

    switch (definition.nodeType) {
      case "EnumDefinition": {
        // do nothing, doesn't need a pointer
        break;
      }
      case "StructDefinition": {
        const stateInfo = allocateStruct(definition, referenceDeclarations, <DecodeUtils.Allocation.Slot>{
          offset: new BN(0)
        });
        result[id].members = stateInfo.variables;
      }
    }
  });

  return [referenceDeclarations, result];
}

export function getEventDefinitions(contracts: ContractObject[]): AstReferences {
  const types = [
    "EventDefinition"
  ];

  return getDeclarationsForTypes(contracts, types);
}

function allocateStruct(structDefinition: any, referenceDeclarations: AstReferences, slot: DecodeUtils.Allocation.Slot, isChildVariable: boolean = false): ContractStateInfo {
  let structSlotAllocation: SlotAllocation = {
    offset: new BN(0),
    index: DecodeUtils.EVM.WORD_SIZE - 1
  };
  let structContractState: ContractStateInfo = {
    variables: {},
    slot: structSlotAllocation
  };

  if (structDefinition) {
    for (let l = 0; l < structDefinition.members.length; l++) {
      const memberNode = structDefinition.members[l];
      allocateDefinition(memberNode, structContractState, referenceDeclarations, slot, true);
    }
  }

  return structContractState;
}

export function allocateDefinition(node: any, state: ContractStateInfo, referenceDeclarations: AstReferences, path?: DecodeUtils.Allocation.Slot, isChildVariable: boolean = false): void {
  let slot: DecodeUtils.Allocation.Slot = {
    offset: state.slot.offset.clone()
  };

  if (typeof path !== "undefined") {
    slot.path = cloneDeep(path);
  }

  const nodeTypeClass = DecodeUtils.Definition.typeClass(node);

  if (DecodeUtils.Definition.requireStartOfSlot(node) && state.slot.index < DecodeUtils.EVM.WORD_SIZE - 1) {
    // structs, mappings, and arrays need to start on their own slot
    state.slot.index = DecodeUtils.EVM.WORD_SIZE - 1;
    state.slot.offset = state.slot.offset.addn(1);
    slot.offset = slot.offset.addn(1);
  }

  if (nodeTypeClass != "struct") {
    let referenceDeclaration: undefined | DecodeUtils.AstDefinition = undefined;
    if (nodeTypeClass === "enum") {
      const referenceId = node.referencedDeclaration ||
        (node.typeName ? node.typeName.referencedDeclaration : undefined);
      referenceDeclaration = referenceDeclarations[referenceId];
    }
    const storageSize = DecodeUtils.Definition.storageSize(node, referenceDeclaration);

    let range = DecodeUtils.Allocation.allocateValue(slot, state.slot.index, storageSize);
    if (nodeTypeClass === "array" && !DecodeUtils.Definition.isDynamicArray(node)) {
      const length = parseInt(node.typeName.length.value);
      const baseDefinition = DecodeUtils.Definition.baseDefinition(node);

      if (DecodeUtils.Definition.typeClass(baseDefinition) === "struct") {
        const referenceId = baseDefinition.referencedDeclaration ||
          (baseDefinition.typeName ? baseDefinition.typeName.referencedDeclaration : undefined);
        const structDefinition = referenceDeclarations[referenceId];
        const structContractState = allocateStruct(structDefinition, referenceDeclarations, <DecodeUtils.Allocation.Slot>{
          path: slot,
          offset: new BN(0)
        }, true);

        range.next.slot.offset = range.next.slot.offset.add(structContractState.slot.offset);
        if (structContractState.slot.index === DecodeUtils.EVM.WORD_SIZE - 1) {
          range.next.slot.offset = range.next.slot.offset.subn(1);
        }
      }
      else {
        const baseDefinitionStorageSize = DecodeUtils.Definition.storageSize(baseDefinition);
        const totalAdditionalSlotsUsed = Math.ceil(length * baseDefinitionStorageSize / DecodeUtils.EVM.WORD_SIZE) - 1;
        range.next.slot.offset = range.next.slot.offset.addn(totalAdditionalSlotsUsed);
      }
    }

    state.variables[node.id] = <ContractStateVariable>{
      isChildVariable,
      definition: node,
      pointer: <StoragePointer>{
        storage: cloneDeep(range)
      }
    };

    state.slot.offset = range.next.slot.offset.clone();
    state.slot.index = range.next.index;
  }
  else {
    const referenceId = node.referencedDeclaration || (node.typeName && node.typeName.referencedDeclaration);
    const structDefinition = referenceDeclarations[referenceId]; // ast node of StructDefinition
    const structContractState = allocateStruct(structDefinition, referenceDeclarations, slot);

    state.variables[node.id] = <ContractStateVariable>{
      isChildVariable,
      definition: node,
      pointer: <StoragePointer>{
        storage: {
          from: {
            slot: slot,
            index: 0
          },
          to: {
            slot: slot,
            index: DecodeUtils.EVM.WORD_SIZE - 1
          }
        }
      }
    };

    state.slot.offset = state.slot.offset.add(structContractState.slot.offset);
    state.slot.index = DecodeUtils.EVM.WORD_SIZE - 1;
    if (structContractState.slot.index < DecodeUtils.EVM.WORD_SIZE - 1) {
      state.slot.offset = state.slot.offset.addn(1);
    }
  }
}

function getStateVariables(contract: ContractObject, initialSlotInfo: SlotAllocation, referenceDeclarations: AstReferences): ContractStateInfo {
  let state = <ContractStateInfo>{
    variables: {},
    slot: {
      offset: initialSlotInfo.offset,
      index: initialSlotInfo.index
    }
  }

  // process for state variables
  const contractNode = getContractNode(contract);
  for (let k = 0; k < contractNode.nodes.length; k++) {
    const node = contractNode.nodes[k];

    if (node.nodeType === "VariableDeclaration" && node.stateVariable === true) {
      allocateDefinition(node, state, referenceDeclarations);
    }
  }

  return state;
}

export function getContractStateVariables(contract: ContractObject, contracts: ContractMapping, referenceDeclarations: AstReferences): EvmVariableReferenceMapping {
  let result: EvmVariableReferenceMapping = {};

  if (typeof contract.ast === "undefined") {
    return result;
  }

  const contractNode = getContractNode(contract);

  if (contractNode) {
    // process inheritance
    let slotAllocation: SlotAllocation = {
      offset: new BN(0),
      index: DecodeUtils.EVM.WORD_SIZE - 1
    };

    for (let i = contractNode.linearizedBaseContracts.length - 1; i >= 0; i--) {
      const state = getStateVariables(contracts[contractNode.linearizedBaseContracts[i]], slotAllocation, referenceDeclarations);

      slotAllocation.offset = state.slot.offset;
      slotAllocation.index = state.slot.index;
      merge(result, state.variables);
    }
  }

  return result;
}