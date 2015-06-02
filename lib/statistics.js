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

module.exports = Statistics;
function Statistics() {
    this.history = [];
}

Statistics.unserialize = function(state) {
    var statistics = Object.create(Statistics.prototype);
    for (var key in state) statistics[key] = state[key];
    return statistics;
};

Statistics.prototype = {
    total: 0,
    pending: 0,
    unique: 0,
    duplicate: 0,
    failed: 0,
    skipped: 0,

    get remaining() {
        return this.total - this.unique - this.duplicate - this.failed - this.skipped;
    },

    set remaining(val) {}, // read-only

    get processed() {
        return this.unique + this.duplicate + this.failed + this.skipped;
    },

    set processed(val) {}, // read-only

    toJSON: function() {
        return {
            history: this.history,
            total: this.total,
            pending: 0,
            unique: this.unique,
            duplicate: this.duplicate,
            failed: this.failed,
            skipped: this.skipped
        };
    },

    snapshot: function() {
        var now = {
            date: Date.now(),
            total: this.total,
            pending: this.pending,
            unique: this.unique,
            duplicate: this.duplicate,
            failed: this.failed,
            skipped: this.skipped,
            remaining: this.remaining,
            processed: this.processed,
            speed: 0
        };

        // Keep a history of 10 seconds.
        this.history.push(now);
        while (this.history[0].date < now.date - 10000) this.history.shift();

        if (this.history.length >= 2) {
            var oldest = this.history[0];
            if (now.date > oldest.date) {
                now.speed = Math.round((now.processed - oldest.processed) / (now.date - oldest.date) * 1000);
            }
        }

        return now;
    }
};
