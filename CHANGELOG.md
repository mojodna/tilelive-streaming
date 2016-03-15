# Changes

## v0.6.4 - 3/15/16

* Re-organize source tree to prevent enhancer conflicts
* Correct handle `setHeaders` when metatiling

## v0.6.3 - 3/11/16

* Correctly handle "Tile does not exist" errors
* Cleaner stream / error handling

## v0.6.2 - 3/4/16

* Fix `stream.push() after EOF` error.

## v0.6.1 - 2/15/16

* Export `applyDefaults` and `clone` for use by `lib/mbtiles` as a source (james.flemer@ndpgroup.com)

## v0.6.0 - 1/7/16

* Fix off-by-one in concurrency handling
* Use `debug` for debugging. Set `DEBUG=tilelive-streaming` in the environment
  to enable.
* Don't treat `Tile|Grid does not exist` errors as fatal.
* Allow errors to be handled by stream consumers.

## v0.5.3 - 1/7/16

* Export `restrict` for use by `lib/mbtiles`

## v0.5.2 - 10/22/15

* Fix error propagation

## v0.5.1 - 7/22/15

* Expose `sourceURI` property on sources

## v0.5.0 - 7/21/15

* Removed `applyDefaults`, `clone`, and `restrict` from exports
* Enhance `tilelive` with a `pipe` method that streams sources when they're
  loaded
* Enhance sources with a `pipe` method that streams tiles as they're created
* Enhance source `getTile` methods to return `TileStream`s

## v0.4.0 - 6/2/15

* Imported and patched (for Node 0.12+) Scheme-related modules from
  tilelive@4.5.3

## v0.3.1 - 5/9/15

* Apply default concurrency values to all public APIs that take options

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
