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

var fs = require('fs');
var unserialize = require('./tile').unserialize;
var Scheme = require('./scheme');
var Tile = require('./tile').Tile;
var Statistics = require('./statistics');

module.exports = FileScheme;
require('util').inherits(FileScheme, Scheme);
function FileScheme(options) {
    this.type = 'file';
    if (!options.list) throw new Error('Parameter list required');
    this.concurrency = options.concurrency || 8;

    this.list = [];
    this.raw = fs.readFileSync(options.list, 'utf8');
    this.last = '';
    this.offset = 0;
    this.chunk = options.chunk || 1e6;
    this.readlines();

    this.stats = new Statistics();
    this.stats.total = this.raw.split('\n').filter(function(line) { return line.trim().length; }).length;

    this.initialize();
}

FileScheme.prototype.readlines = function() {
    var rest = this.raw.substr(this.offset, this.chunk);
    var read = this.last + rest;
    var lines = read.split('\n').filter(function(line) { return line.trim().length; });
    this.last = rest.length === this.chunk ? lines.pop() : '';
    this.offset += this.chunk;
    if (/[\d]+\/[\d]+\/[\d]+/.test(lines[0])) {
        for (var i = 0; i < lines.length; i++) {
            var coords = lines[i].split('/');
            this.list.push(new Tile(+coords[0], +coords[1], +coords[2]));
        }
    } else {
        for (var i = 0; i < lines.length; i++) {
            var state = JSON.parse(lines[i]);
            this.list.push(new Tile(state.z, state.x, state.y, state.key));
        }
    }
}

FileScheme.unserialize = function(state) {
    var scheme = Object.create(FileScheme.prototype);
    for (var key in state) scheme[key] = state[key];
    scheme.list = unserialize(state.pending).concat(unserialize(state.list));
    scheme.stats = Statistics.unserialize(state.stats);
    scheme.initialize();
    return scheme;
};

FileScheme.prototype.next = function() {
    if (!this.list.length) this.readlines();

    var formats = (this.task.formats && this.task.formats.length > 0) ? this.task.formats : ['tile'];
    while (!this.paused && this.list.length && this.pending.length < this.concurrency) {
        var tile = this.list.shift();
        for (var key in formats) {
            this.addPending(tile);
            this.task.render(tile,formats[key]);
        }
    }

    if (!this.paused && !this.finished && !this.list.length && !this.pending.length && !this.last) {
        this.finished = true;
        this.task.finished();
    }
};
