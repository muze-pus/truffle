import debugModule from "debug";
const debug = debugModule("debugger:txlog:sagas");

import { put, takeEvery, select } from "redux-saga/effects";
import { prefixName } from "lib/helpers";
import * as Codec from "@truffle/codec";

import * as actions from "../actions";
import { TICK } from "lib/trace/actions";
import * as trace from "lib/trace/sagas";
import * as data from "lib/data/sagas";

import txlog from "../selectors";

function* tickSaga() {
  yield* updateTransactionLogSaga();
  yield* trace.signalTickSagaCompletion();
}

function* updateTransactionLogSaga() {
  if (yield select(txlog.current.isHalting)) {
    //note that we process this case first so that it overrides the others!
    const status = yield select(txlog.current.returnStatus);
    if (status) {
      if (yield select(txlog.current.isSelfDestruct)) {
        const beneficiary = yield select(txlog.current.beneficiary);
        //note: this selector returns null for a value-destroying selfdestruct
        yield put(actions.selfdestruct(beneficiary));
      } else {
        const decodings = yield* data.decodeReturnValue();
        yield put(actions.externalReturn(decodings));
      }
    } else {
      const message = yield* data.decodeReturnValue();
      yield put(actions.revert(message));
    }
  } else if (yield select(txlog.current.isJump)) {
    const jumpDirection = yield select(txlog.current.jumpDirection);
    if (jumpDirection === "i") {
      const internal = yield select(txlog.next.inInternalSourceOrYul); //don't log jumps into internal sources or Yul
      if (!internal) {
        //we don't do any decoding/fn identification here because that's handled by
        //the function definition case
        yield put(actions.internalCall());
      }
    } else if (jumpDirection === "o") {
      const internal = yield select(txlog.current.inInternalSourceOrYul); //don't log jumps out of internal sources or Yul
      if (!internal) {
        //in this case, we have to do decoding & fn identification
        const outputAllocations = yield select(
          txlog.current.outputParameterAllocations
        );
        if (outputAllocations) {
          const compilationId = yield select(txlog.current.compilationId);
          //can't do a yield* inside a map, have to do this loop manually
          let variables = [];
          for (let { name, definition, pointer } of outputAllocations) {
            name = name ? name : undefined; //replace "" with undefined
            const decodedValue = yield* data.decode(
              definition,
              pointer,
              compilationId
            );
            variables.push({ name, value: decodedValue });
          }
          yield put(actions.internalReturn(variables));
        } else {
          yield put(actions.internalReturn(null));
        }
      }
    }
  } else if (yield select(txlog.current.isCall)) {
    const address = yield select(txlog.current.callAddress);
    const value = yield select(txlog.current.callValue);
    //distinguishing DELEGATECALL vs CALLCODE seems unnecessary here
    const isDelegate = yield select(txlog.current.isDelegateCallBroad);
    //we need to determine what kind of call this is.
    //we'll sort them into: function, constructor, message, library
    //(library is a placeholder to be replaced later)
    const context = yield select(txlog.current.callContext);
    const calldata = yield select(txlog.current.callData);
    const instant = yield select(txlog.current.isInstantCallOrCreate);
    const kind = callKind(context, calldata, instant);
    const decoding = yield* data.decodeCall();
    if (instant) {
      const status = yield select(txlog.current.returnStatus);
      yield put(
        actions.instantExternalCall(
          address,
          context,
          value,
          isDelegate,
          kind,
          decoding,
          calldata,
          status
        )
      );
    } else {
      yield put(
        actions.externalCall(
          address,
          context,
          value,
          isDelegate,
          kind,
          decoding,
          calldata
        )
      );
    }
  } else if (yield select(txlog.current.isCreate)) {
    const address = yield select(txlog.current.createdAddress);
    const context = yield select(txlog.current.callContext);
    const value = yield select(txlog.current.createValue);
    const salt = yield select(txlog.current.salt); //is null for an ordinary create
    const instant = yield select(txlog.current.isInstantCallOrCreate);
    const binary = yield select(txlog.current.createBinary);
    const decoding = yield* data.decodeCall();
    if (instant) {
      const status = yield select(txlog.current.returnStatus);
      yield put(
        actions.instantCreate(
          address,
          context,
          value,
          salt,
          decoding,
          binary,
          status
        )
      );
    } else {
      yield put(
        actions.create(address, context, value, salt, decoding, binary)
      );
    }
  }
  //we process this last in case jump & function def on same step
  if (yield select(txlog.current.onFunctionDefinition)) {
    if (yield select(txlog.current.waitingForFunctionDefinition)) {
      debug("identifying");
      const inputAllocations = yield select(
        txlog.current.inputParameterAllocations
      );
      debug("inputAllocations: %O", inputAllocations);
      if (inputAllocations) {
        const functionNode = yield select(txlog.current.node);
        const contractNode = yield select(txlog.current.contract);
        const compilationId = yield select(txlog.current.compilationId);
        //can't do a yield* inside a map, have to do this loop manually
        let variables = [];
        for (let { name, definition, pointer } of inputAllocations) {
          const decodedValue = yield* data.decode(
            definition,
            pointer,
            compilationId
          );
          variables.push({ name, value: decodedValue });
        }
        yield put(
          actions.identifyFunctionCall(functionNode, contractNode, variables)
        );
      }
    }
  }
}

function callKind(context, calldata, instant) {
  if (context) {
    if (context.contractKind === "library") {
      return instant ? "message" : "library";
      //for an instant return, just get it out of the way and set it to
      //message rather than leaving it open (it'll get resolved in favor
      //of message by our criteria)
    } else {
      const abi = context.abi;
      debug("abi: %O", abi);
      const selector = calldata
        .slice(0, 2 + 2 * Codec.Evm.Utils.SELECTOR_SIZE)
        .padEnd("00", 2 + 2 * Codec.Evm.Utils.SELECTOR_SIZE);
      debug("selector: %s", selector);
      if (abi && selector in abi) {
        return "function";
      }
    }
  }
  return "message";
}

export function* reset() {
  yield put(actions.reset());
}

export function* unload() {
  yield put(actions.unloadTransaction());
}

export function* begin() {
  const origin = yield select(txlog.transaction.origin);
  debug("origin: %s", origin);
  yield put(actions.recordOrigin(origin));
  const { address, storageAddress, value, data: calldata } = yield select(
    txlog.current.call
  );
  const context = yield select(txlog.current.context);
  //note: there was an instant check here (based on checking if there are no
  //trace steps) but I took it out, because even though having no trace steps
  //is essentially an insta-call, the debugger doesn't treat it that way (it
  //will see the return later), so we shouldn't here either
  const decoding = yield* data.decodeCall(true); //pass flag to decode *current* call
  debug("decoding: %O", decoding);
  if (address) {
    const kind = callKind(context, calldata, false); //no insta-calls here!
    yield put(
      actions.externalCall(address, context, value, false, kind, decoding)
    ); //initial call is never delegate
  } else {
    yield put(actions.create(storageAddress, context, value, null, decoding)); //initial create never has salt
  }
}

export function* saga() {
  yield takeEvery(TICK, tickSaga);
}

export default prefixName("txlog", saga);
