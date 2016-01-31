'use strict'

const Stream = require('stream')
const thunk = require('thunks')()
const thunkStream = require('thunk-stream')
const EventEmitter = require('events').EventEmitter
const slice = Array.prototype.slice

class Tasks extends EventEmitter {
  constructor () {
    super()
    this.actors = []
    this.isRunning = false
    this.tasks = Object.create(null)
  }

  task (name, dep, task) {
    if (typeof name !== 'string') {
      throw new Error('Task requires a name that is a string')
    }
    if (this.tasks[name]) {
      throw new Error('Task ' + name + ' exists')
    }
    if (!Array.isArray(dep)) {
      task = dep
      dep = []
    }

    task = task || noOp
    if (typeof task !== 'function') {
      throw new Error('Task ' + name + ' requires a body that is a function')
    }
    this.tasks[name] = new Task(name, task, dep)
    return this
  }

  run () {
    let args = slice.call(arguments)
    let cb = args[args.length - 1]
    if (typeof cb !== 'function') {
      cb = null
    } else {
      args = args.slice(0, -1)
    }

    if (!args.length) {
      args.push('default')
    }
    this.isRunning = true
    this.emit('start', args)
    let tasks = thunk.call(this, this.co.apply(this, args))((err) => {
      this.cleanup()
      if (err) {
        this.emit('error', err)
        this.emit('err', err) // Back compatible
        throw err
      }
      this.emit('stop')
    })
    return cb ? tasks(cb) : tasks
  }

  co () {
    let args = slice.call(arguments)
    return (done) => thunk.seq.call(this, evalTasks.call(this, args, true))(done)
  }

  all (args) {
    args = Array.isArray(args) ? args : slice.call(arguments)
    return (done) => thunk.all.call(this, evalTasks.call(this, args))(done)
  }

  seq (args) {
    args = Array.isArray(args) ? args : slice.call(arguments)
    return (done) => thunk.seq.call(this, evalTasks.call(this, args))(done)
  }

  cleanup () {
    this.actors.map((name) => {
      let task = this.tasks[name]
      task.fnPromise = null
      task.duration = 0
      task.hrDuration = 0
    })
    this.isRunning = false
    this.actors.length = 0
  }

  reset () {
    this.cleanup()
    this.tasks = Object.create(null)
  }
}

function evalTask (name) {
  let task = this.tasks[name]
  if (!task) {
    let err = new Error('Task ' + name + ' not found')
    taskEmit(this, name, 'not_found', err)
    throw err
  }
  this.actors.push(name)
  return thunk.call(this, (done) => {
    let tasks = [task.eval(this)]
    if (task.dep.length) {
      tasks.unshift(thunk.all(evalTasks.call(this, task.dep)))
    }
    thunk.seq(tasks)(done)
  })
}

function evalTasks (tasks, evalSub) {
  return tasks.map((name) => {
    if (evalSub && Array.isArray(name)) {
      return thunk.all(evalTasks.call(this, name))
    }
    return evalTask.call(this, name)
  })
}

function Task (name, task, dep) {
  this.fn = task
  this.dep = dep
  this.name = name
  this.duration = 0 // Seconds
  this.hrDuration = 0 // [seconds,nanoseconds]
  this.fnPromise = null
}

Task.prototype.eval = function (parent) {
  this.fnPromise = this.fnPromise || thunk.persist((callback) => {
    this.duration = 0
    this.hrDuration = 0
    taskEmit(parent, this.name, 'start')

    let start = process.hrtime()
    let target = this.fn.length ? this.fn : this.fn.call(parent)
    let handle = target instanceof Stream ? thunkStream : thunk

    handle.call(parent, target)((err) => {
      this.hrDuration = process.hrtime(start)
      this.duration = this.hrDuration[0] + (this.hrDuration[1] / 1e9)
      if (err) {
        taskEmit(parent, this.name, 'err', err)
        throw err
      }
      taskEmit(parent, this.name, 'stop', {
        hrDuration: this.hrDuration,
        duration: this.duration
      })
    })(callback)
  })
  return this.fnPromise
}

function noOp () {}

function taskEmit (ctx, taskName, eventName, data) {
  data = data || {}
  if (eventName === 'err') {
    data.err = data // Back compatible
  }
  data.task = taskName
  data.src = 'task_' + eventName
  data.message = data.message || taskName + ' ' + eventName
  ctx.emit(data.src, data)
}

module.exports = Tasks
