import { combineReducers } from "redux";

import * as actions from "./actions";

export function index(state = 0, action) {
  if (action.type === actions.TOCK) {
    return state + 1;
  }
  else {
    return state;
  }
}

export function finished(state = false, action)
{
  if(action.type === actions.END_OF_TRACE)
  {
    return true;
  }
  else
  {
    return state;
  }
}

export function steps(state = null, action) {
  if (action.type === actions.SAVE_STEPS) {
    return action.steps;
  } else {
    return state;
  }
}

const info = combineReducers({
  steps
});

const proc = combineReducers({
  index,
  finished
});

const reducer = combineReducers({
  info,
  proc
});

export default reducer;
