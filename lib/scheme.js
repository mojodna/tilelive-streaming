// Copyright (c) 2011, Development Seed
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without modification,
// are permitted provided that the following conditions are met:
//
// - Redistributions of source code must retain the above copyright notice, this
//   list of conditions and the following disclaimer.
// - Redistributions in binary form must reproduce the above copyright notice, this
//   list of conditions and the following disclaimer in the documentation and/or
//   other materials provided with the distribution.
// - Neither the name "Development Seed" nor the names of its contributors may be
//   used to endorse or promote products derived from this software without
//   specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
// ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
// WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
// DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
// ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
// (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
// LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
// ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
// SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

var EventEmitter = require('events');

var Statistics = require('./statistics');
var Tile = require('./tile').Tile;
var Metatile = require('./tile').Metatile;

module.exports = Scheme;
require('util').inherits(Scheme, EventEmitter);
function Scheme() {
    throw new Error('not instantiable');
}

Scheme.types = {
    file: require('./filescheme'),
    pyramid: require('./pyramidscheme'),
    scanline: require('./scanlinescheme')
};



Scheme.unserialize = function(state) {
    return Scheme.types[state.type].unserialize(state);
};

Scheme.create = function(type, options) {
    return new Scheme.types[type](options);
};

Scheme.prototype.started = false;
Scheme.prototype.finished = false;
Scheme.prototype.paused = true;

Scheme.prototype.initialize = function() {
    this.pending = [];
    Object.defineProperty(this, 'next', { value: this.next.bind(this) });
};

Scheme.prototype.start = function() {
    if (this.finished) {
        this.task.finished();
    } else {
        this.paused = false;
        this.started = true;
        this.next();
    }
};

Scheme.prototype.pause = function() {
    if (!this.paused) {
        this.paused = true;
        if (!this.pending.length) {
            this.emit('paused');
        }
    } else if (!this.started) {
        this.emit('paused');
    }
};

Scheme.prototype.addPending = function(tile) {
    this.pending.push(tile);
    this.stats.pending++;
};

Scheme.prototype.removePending = function(tile) {
    var index = this.pending.indexOf(tile);
    if (index >= 0) {
        this.pending.splice(index, 1);
        this.stats.pending--;
    }
    if (this.paused && !this.pending.length) {
        this.emit('paused');
    }
};

Scheme.prototype.error = function(tile) {
    this.removePending(tile);
    this.stats.failed++;
    process.nextTick(this.next);
};

Scheme.prototype.unique = function(tile) {
    this.removePending(tile);
    this.stats.unique++;
    process.nextTick(this.next);
};

Scheme.prototype.skip = function(tile) {
    this.removePending(tile);
    this.stats.skipped++;
    process.nextTick(this.next);
};

Scheme.prototype.duplicate = function(tile) {
    this.removePending(tile);
    this.stats.duplicate++;
    process.nextTick(this.next);
};
