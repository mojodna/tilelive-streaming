# Changes

## v0.3.0 - 4/30/15

* Make concurrency configurable via `options` (the final object to all
  constructors and factory methods)
* Limit the number of pending `_read()` calls to `options.concurrency`

## v0.2.0 - 4/14/15

* `Readable` now emits pings (`{}`, which are ignored by `Collector`) in order
   to facilitate concurrent buffering.

## v0.1.6 - 4/9/15

* Correctly finish reading from MBTiles

## v0.1.5 - 1/2/15

* Respect `stream.push`'s return value to buffer correctly

## v0.1.4 - 10/13/14

* Explicitly depend on `tilelive@^4.5.3`

## v0.1.3 - 10/13/14

* Upgraded dependencies

## v0.1.2 - 6/12/14

* `mbtiles`: `close()` when done
* `mbtiles`: Re-emit `finish` events properly
* `mbtiles`: Check for `_isWritable` correctly

## v0.1.1 - 6/9/14

* Provide defaults for empty `info`
* Explicitly specify a `highWaterMark` for object streams

## v0.1.0 - 6/6/14

* Initial release
