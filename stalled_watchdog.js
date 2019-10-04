var defaultOptions = require('./default_watchdog_options');
var EventEmitter = require('events').EventEmitter;
var scripts = require('./scripts');
var extend = require('xtend');
var Redis = require('ioredis');

module.exports = createWatchdog;

function createWatchdog(queueName, options) {

  var self = new EventEmitter();

  options = extend({}, defaultOptions, options || {});

  var queues = {
    pending: queueName + '-pending',
    timeout: queueName + '-timeout',
    stalled: queueName + '-stalled',
  };

  /// state vars
  var listening = false;
  var stopping = false;

  process.nextTick(init);

  self.stop = stop;

  return self;


  /// Init

  function init() {
    options.client = new Redis(options.port, options.host, options.redisOptions);
    if (options.password) options.client.auth(options.password);
    options.client.once('ready', onReady);
    options.client.on('error', errorIfError);
  }

  function onReady() {
    self.emit('ready');
    poll();
  }

  function poll() {
    if (! stopping && ! listening) {
      listening = true;
      self.emit('polling');

      options.client.lrange(queues.stalled, 0, -1, maybeStalled);
    }
  }

  function maybeStalled(err, maybeStalled) {
    listening = false;

    setTimeout(poll, options.pollInterval);

    if (err) self.emit('error', err);

    if (maybeStalled && maybeStalled.length) {
      maybeStalled.forEach(function(workId) {
        setTimeout(checkIfStalled(workId), options.stalledTimeout);
      });
    }

  }

  function checkIfStalled(workId) {
    return function() {
      scripts.run.call(options.client, 'stalled', 1,
        queueName,
        queues.timeout, queues.pending, queues.stalled, Date.now(),
        options.stalledTimeout, workId,
        done);
    }
  }

  function done(err, workId) {
    if (err) self.emit('error', err);
    if (workId) self.emit('stalled requeued', workId);
  }


  /// Stop

  function stop(cb) {
    if (stopping) return cb();
    stopping = true;
    options.client.quit();
    options.client.once('end', ended);

    function ended() {
      self.emit('end');
      if (cb) cb();
    }
  }


  /// Misc

  function errorIfError(err) {
    if (err && ! stopping) error(err);
  }

  function error(err) {
    if (Array.isArray(err)) err.forEach(error);
    else self.emit('error', err);
  }
}
