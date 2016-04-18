# node-red-contrib-freebox

A node to call the freebox API.


# Installation
```
npm install node-red-contrib-freebox
```

# Configuration

the first time the api connect to the freebox:
 the freebox will display the Authorization demand on the LCD Display
you must authorize it to connect 

# Usage

An incoming message triggers a freebox API call like "calls/log" see http://mafreebox.freebox.fr/#Fbx.os.app.help.app.
The message payload is API desired.
the output message payload is the result ( JSON )
