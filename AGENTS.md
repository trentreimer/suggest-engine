# suggest-engine

Editor-agnostic autocomplete suggestion engine with optional context ranking.
The optional user-words feature also enables words a user enters repeatedly to 
be learned on-device and suggested ahead of shipped dictionaries. 

When context data is loaded, suggestions also account for the word that precedes 
the caret.

Zero runtime dependencies. Plain ES modules.

## usage

When adding features to this library, try to make them as simple to use as
possible for the editor application. Whenever possible, let general configuration 
options suffice to produce expected output for a very few function called by the
editor application, rather than requiring the editor application to apply
more logic.
