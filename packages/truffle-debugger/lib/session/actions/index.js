export const START = "SESSION_START";
export function start(provider, txHash) {
  return {
    type: START,
    provider,
    txHash //OPTIONAL
  };
}

export const LOAD = "LOAD";
export function load(txHash) {
  return {
    type: LOAD,
    txHash
  };
}

export const UNLOAD = "SESSION_UNLOAD";
export function unload() {
  return {
    type: UNLOAD
  };
}

export const READY = "SESSION_READY";
export function ready(withTransaction) {
  return {
    type: READY,
    withTransaction
  };
}

export const ERROR = "SESSION_ERROR";
export function error(error) {
  return {
    type: ERROR,
    error
  };
}

export const RECORD_CONTRACTS = "RECORD_CONTRACTS";
export function recordContracts(contexts, sources) {
  return {
    type: RECORD_CONTRACTS,
    contexts,
    sources
  };
}

export const SAVE_TRANSACTION = "SAVE_TRANSACTION";
export function saveTransaction(transaction) {
  return {
    type: SAVE_TRANSACTION,
    transaction
  };
}

export const SAVE_RECEIPT = "SAVE_RECEIPT";
export function saveReceipt(receipt) {
  return {
    type: SAVE_RECEIPT,
    receipt
  };
}

export const SAVE_BLOCK = "SAVE_BLOCK";
export function saveBlock(block) {
  return {
    type: SAVE_BLOCK,
    block
  };
}
