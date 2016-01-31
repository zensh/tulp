'use strict'

const vfs = require('vinyl-fs')
const Tasks = require('./lib/tasks')
const chokidar = require('chokidar')

class Tulp extends Tasks {
  constructor () {
    super()
  }

  watch (glob, opt, handle) {
    if (typeof opt === 'function' || Array.isArray(opt)) {
      handle = opt
      opt = {}
    }

    opt = opt || {}

    if (Array.isArray(handle)) handle = () => this.run.apply(this, handle)

    if (opt.ignoreInitial == null) {
      opt.ignoreInitial = true
    }

    let watcher = chokidar.watch(glob, opt)
      .on('change', handle)
      .on('unlink', handle)
      .on('add', handle)

    return watcher
  }
}

Tulp.prototype.start = Tulp.prototype.run
Tulp.prototype.src = vfs.src
Tulp.prototype.dest = vfs.dest
Tulp.prototype.Tulp = Tulp

module.exports = new Tulp()
