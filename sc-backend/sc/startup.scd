// SuperCollider headless startup.
// scsynth connects to the JACK server pre-started by start.sh.
// Sample rate and period are determined by jackd (-r 44100 -p 2048).

s.options.numOutputBusChannels = 2;
s.options.numInputBusChannels  = 0;
s.options.memSize              = 8192;  // MB of RT memory for the server

s.waitForBoot({
    "=== SuperCollider server booted ===".postln;
});
