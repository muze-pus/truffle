const helpers = require("./helpers");
const { createLookupTable, sortHandlers, validateOptions } = helpers;

class Subscriber {
  constructor({ emitter, options }) {
    validateOptions(options);
    const { initialization, handlers } = options;

    this.emitter = emitter;

    if (initialization) initialization.bind(this)();

    const { globbedHandlers, nonGlobbedHandlers } = sortHandlers(handlers);

    if (nonGlobbedHandlers) this.setUpListeners(nonGlobbedHandlers);

    if (globbedHandlers) {
      this.globbedHandlers = globbedHandlers;
      this.setUpGlobbedListeners(globbedHandlers);
    }
  }

  handleEvent(eventName, data) {
    for (let handlerName in this.globbedHandlerLookupTable) {
      if (this.regexMatchesEntireName(eventName, handlerName)) {
        this.globbedHandlers[handlerName].forEach(handler => {
          handler.bind(this, data)();
        });
      }
    }
  }

  regexMatchesEntireName(eventName, handlerName) {
    const matches = eventName.match(
      this.globbedHandlerLookupTable[handlerName]
    );
    if (!matches) return null;
    const filteredMatches = matches.filter(match => typeof match === "string");
    return filteredMatches.find(filteredMatch => filteredMatch === eventName);
  }

  setUpGlobbedListeners(handlers) {
    const handlerNames = Object.keys(handlers);
    this.globbedHandlerLookupTable = createLookupTable(handlerNames);
    this.emitter.onAny(this.handleEvent.bind(this));
  }

  setUpListeners(handlers) {
    for (let handlerName in handlers) {
      handlers[handlerName].forEach(handler => {
        this.emitter.on(handlerName, handler.bind(this));
      });
    }
  }
}

module.exports = Subscriber;
