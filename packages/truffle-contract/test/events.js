var assert = require("chai").assert;
var util = require('./util');

describe("Events [ @geth ]", function() {
  var Example;
  var accounts;
  var network_id;
  var web3;
  var providerOptions = {vmErrorsOnRPCResponse: false};

  before(function() {
    this.timeout(10000);

    Example = util.createExample();

    return util
      .setUpProvider(Example, providerOptions)
      .then(result => {
        web3 = result.web3;
        accounts = result.accounts;
      });
  });

  it('should expose the "on" handler / format event correctly', function(done){
    Example.new(1).then(example => {
      const event = example.ExampleEvent()

      event.on('data', function(data){
        assert.equal("ExampleEvent", data.event);
        assert.equal(accounts[0], data.args._from);
        assert.equal(8, data.args.num); // 8 is a magic number inside Example.sol
        this.removeAllListeners();
        done();
      });

      example.triggerEvent();
    });
  });

  it('should expose the "once" handler', function(done){
    Example.new(1).then(example => {
      const event = example.ExampleEvent()

      event.once('data', function(data){
        assert.equal("ExampleEvent", data.event);
        assert.equal(accounts[0], data.args._from);
        assert.equal(8, data.args.num); // 8 is a magic number inside Example.sol
        this.removeAllListeners();
        done();
      });

      example.triggerEvent();
    });
  })

  it('should fire repeatedly (without duplicates)', async function(){
    let emitter;
    let counter = 0;
    const example = await Example.new(1)

    example
      .ExampleEvent()
      .on('data', function(data){
        emitter = this;
        counter++
      });

    await example.triggerEventWithArgument(1);
    await example.triggerEventWithArgument(2);
    await example.triggerEventWithArgument(3);

    assert(counter === 3, 'emitter should have fired repeatedly');
    emitter.removeAllListeners();
  });

  it('should listen for `allEvents`', async function(){
    let emitter;
    const events = [];
    const signatures = ['ExampleEvent', 'SpecialEvent'];
    const example = await Example.new(1)

    example
      .allEvents()
      .on('data', function(data){
        data.event && events.push(data.event);
        emitter = this;
      });

    await example.triggerEvent();
    await example.triggerSpecialEvent();

    assert(events.includes(signatures[0]), `Expected to hear ${signatures[0]}`);
    assert(events.includes(signatures[1]), `Expected to hear ${signatures[1]}`);
    emitter.removeAllListeners();
  });

  it('should `getPastEvents`', async function(){
    const signatures = ['ExampleEvent', 'SpecialEvent'];
    const example = await Example.new(1)
    const options = {fromBlock: 0, toBlock: "latest"};

    await example.triggerEvent();
    await example.triggerEvent();

    await example.triggerSpecialEvent();
    await example.triggerSpecialEvent();

    const exampleEvent = await example.getPastEvents('ExampleEvent', options);
    const specialEvent = await example.getPastEvents('SpecialEvent', options);

    assert(exampleEvent.length === 2);
    assert(exampleEvent[0].event === signatures[0]);
    assert(exampleEvent[1].event === signatures[0]);

    assert(specialEvent.length === 2);
    assert(specialEvent[0].event === signatures[1]);
    assert(specialEvent[1].event === signatures[1]);
  });
});
