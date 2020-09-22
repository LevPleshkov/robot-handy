/*
/   Created by Lev Pleshkov, June 2020.
/
*/

// Spark AR modules
    const Scene = require('Scene');
    const Time = require('Time');
    const TouchGestures = require('TouchGestures');
    const DeviceMotion = require('DeviceMotion');
    const Reactive = require('Reactive');
    const Diagnostics = require('Diagnostics');
    const Patches = require('Patches');

// cannon.js library
    const CANNON = require('cannon');

// Configuration
    const CUBE_SIZE = 0.1;
    const CUBE_MASS = 10;
    const STRENGTH  = CUBE_MASS * 300;
    const ROBOT_HEIGHT = 0.4;
    const ROBOT_SPEED = 0.3;
    const ROBOT_PRECISION = 0.0001;

// Device information
    const deviceWorldRotX = DeviceMotion.worldTransform.rotationX;
    const deviceWorldRotY = DeviceMotion.worldTransform.rotationY;
    const deviceWorldRotZ = DeviceMotion.worldTransform.rotationZ;
    
// Cannon world
    const fps = 1.0 / 60.0;
    const timeInterval = 10;
    const world = new CANNON.World();
    world.gravity.set(0, -9.8, 0);
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 5;
    world.defaultContactMaterial.contactEquationStiffness = 1e16;
    world.defaultContactMaterial.contactEquationRelaxation = 5;
    world.defaultContactMaterial.restitution = 0.0;
    world.defaultContactMaterial.friction = 100.0;
    world.allowSleep = true;

// Tie objects from Scene to cannon world objects
    var cubes = new Array();
    var cubeBodies = new Array();
    var cubeOrigins = new Array();

    Promise.all([
        Scene.root.findFirst('cube0'),
        Scene.root.findFirst('cube1'),
        Scene.root.findFirst('cube2'),
        Scene.root.findFirst('cube3'),
        Scene.root.findFirst('cube4'),
        Scene.root.findFirst('cube5'),
        Scene.root.findFirst('cube6'),
        Scene.root.findFirst('cube7')
        
    ]).then( objects => {
        for (let i = 0; i < objects.length; i++) {
            cubes.push(objects[i]);
            addCube(objects[i]);
            
            TouchGestures.onTap(objects[i]).subscribe( gesture => {
                applyTouchImpulse(cubeBodies[i], STRENGTH);
            });

            // Patches.inputs.setScalar("cubeHeight_" + i, objects[i].transform.y);
        }
    });
    

    Scene.root.findFirst('robot').then( object => {
        robot.object = object;

        let robotProperties = {
            mass: 0.001,
            shape: new CANNON.Box(new CANNON.Vec3(0.1, 0.125, 0.1)),
            type: CANNON.Body.KINEMATIC,
        }
        robot.body = new CANNON.Body(robotProperties);
        let x = object.transform.x.pinLastValue();
        let y = object.transform.y.pinLastValue();
        let z = object.transform.z.pinLastValue();
        robot.body.position = new CANNON.Vec3(x, y, z);
        robot.origin = new CANNON.Vec3(x, y, z);
        world.addBody(robot.body);

        TouchGestures.onTap(object).subscribe( gesture => {
            if (robot.isOn) {
                if (!robot.isOnPause)
                    robot.pause();
                else
                    robot.resume();
            } else {
                robot.isOn = true;
                robot.body.sleepState = false;
                Diagnostics.log("bip-bop: ON");
            }
        });

        Patches.inputs.setVector("robotPosition", Reactive.vector(object.transform.x, object.transform.y, object.transform.z));
        Patches.inputs.setScalar("robotHeight", object.transform.y);
    });

    function addCube(cube) {
        let cubeProperties = {
            mass: 5,
            shape: new CANNON.Box(new CANNON.Vec3(CUBE_SIZE / 2, CUBE_SIZE / 2, CUBE_SIZE / 2))
        }
        let cubeBody = new CANNON.Body(cubeProperties);
        let x = cube.transform.x.pinLastValue();
        let y = cube.transform.y.pinLastValue();
        let z = cube.transform.z.pinLastValue();
        cubeBody.position = new CANNON.Vec3(x, y, z);
        cubeBody.allowSleep = true;
        cubeBody.sleepSpeedLimit = 0.9;
        cubeBody.sleepTimeLimit = 1.0;
        cubeBodies.push(cubeBody);
        cubeOrigins.push(new CANNON.Vec3(x, y, z));
        world.addBody(cubeBody);
    }

// Main loop
    var lastTime = 0.0;
    Time.setInterval((elapsedTime) => {
        let dt = elapsedTime - lastTime;
        updateWorld(dt);
        controlRobot();
        lastTime = elapsedTime;
    }, timeInterval);

// Ground plane
    const groundProperties = {
        mass: 0,
        shape: new CANNON.Plane()
    }
    const groundBody = new CANNON.Body(groundProperties);
    groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    world.addBody(groundBody);

// Cannon world update
    var cubesNotInPlace = new Array();
    function updateWorld(timeSinceLastCalled) {
        world.step(fps);//, timeSinceLastCalled, 1);

        for (let i = 0; i < cubes.length; i++) {
            if (cubeBodies[i].type == CANNON.Body.KINEMATIC) {
                cubeBodies[i].position.x = robot.body.position.x;
                cubeBodies[i].position.y = robot.body.position.y - 0.2;
                cubeBodies[i].position.z = robot.body.position.z;
            }

            cubes[i].transform.x = cubeBodies[i].position.x;
            cubes[i].transform.y = cubeBodies[i].position.y;
            cubes[i].transform.z = cubeBodies[i].position.z;
    
            let rotation = {};
            cubeBodies[i].quaternion.toEuler(rotation);
            cubes[i].transform.rotationX = rotation.x;
            cubes[i].transform.rotationY = rotation.y;
            cubes[i].transform.rotationZ = rotation.z;


            if (!inPlace(i) && robot.carryingCube != i) {
                if (!cubesNotInPlace.some(index => index === i)) {
                    cubesNotInPlace.push(i);
                    cubesNotInPlace.sort();
                    Diagnostics.log("displaced: " + cubesNotInPlace.length);
                }
            }
        }
        
        robot.object.transform.x = robot.body.position.x;
        robot.object.transform.y = robot.body.position.y;
        robot.object.transform.z = robot.body.position.z;
    }
    
    function applyTouchImpulse(cubeBody, strength) {
        const x_factor = 8;
        const y_factor = 8;

        let F_x = -Math.atan(x_factor * Math.sin(deviceWorldRotY.pinLastValue())); 
        let F_y =  Math.atan(y_factor * Math.cos(deviceWorldRotY.pinLastValue()) * 
                                        Math.sin(deviceWorldRotX.pinLastValue()) * 
                                        Math.cos(deviceWorldRotZ.pinLastValue()));
        let F_z =                      -Math.cos(deviceWorldRotY.pinLastValue()) * 
                                        Math.cos(deviceWorldRotZ.pinLastValue());

        let force = new CANNON.Vec3(F_x * strength, F_y * strength, F_z * strength);

        cubeBody.sleepState = false;
        cubeBody.force = force;
    }

    function inPlace(index) {

        let dx = Math.abs(cubeBodies[index].position.x - cubeOrigins[index].x);
        let dz = Math.abs(cubeBodies[index].position.z - cubeOrigins[index].z);

        if (dx > 0.05 || dz > 0.05) {
            return false;
        }
        return true;
    }

    function controlRobot() {

        if (!robot.isOnTimeout) {
            if (robot.isOn && !robot.isOnPause) {
                robot.command();
            }
        }

    }

    var robot = {
        object: {},
        body:   {},
        origin: {},

        isOn: false,
        isOnTimeout: false,
        isOnPause: false,
    
        isEmpty: true,
        carryingCube: -1,
        
        get isMoving() {
            return this.body.velocity.length() != 0.0 ? true : false;
        },
        
        get isLanded() {
            return this.body.position.y == 0.1 ? true : false;
        },

        get isAloft() {
            return this.body.position.y == 0.1 + ROBOT_HEIGHT ? true : false;
        },
        
        toCube: false,
        toOrigin: false,
        toBase: false,

        timeouts: [],

        pause: function() {
            this.isOnPause = true;

            for (let i = 0; i < this.timeouts.length; i++) {
                Time.clearTimeout(this.timeouts[i]);
            }

            this.body.velocity.set(0, 0, 0);

            this.targetSet = false;

            // raise to full height
            Diagnostics.log("timeout AA - raise from air");
            this.isOnTimeout = true;
            this.timeouts.push(Time.setTimeout(() => {
                this.raise(ROBOT_HEIGHT + 0.1 - this.body.position.y, 2000);          // timeout raising
                this.timeouts.push(Time.setTimeout(() => {
                    this.body.position.y = ROBOT_HEIGHT + 0.1;
                    this.isOnTimeout = false;
                }, 2000));
            }, 0));                                                                           // timeout AA

            Diagnostics.log("pause");
        },

        resume: function() {
            this.isOnPause = false;
            this.isOnTimeout = false;
            Diagnostics.log("resume");
        },

        shutDown: function() {
            for (let i = 0; i < this.timeouts.length; i++) {
                Time.clearTimeout(this.timeouts[i]);
            }
            this.timeouts = [];

            this.body.position = new CANNON.Vec3(0, 0.1, -0.6); //this.origin;

            this.target = {};
            this.targetSet = false;

            this.isEmpty = true;
            this.carryingCube = -1;
            
            this.toCube = false;
            this.toOrigin = false;
            this.toBase = false;
            
            this.isOn = false;
            this.isOnTimeout = false;
            this.isOnPause = false;

            Diagnostics.log("bip-bop: OFF");
        },

        target: {},
        targetSet: false,

        setTarget: function() {
            Diagnostics.log("target ->");

            // target is displaced cube with smallest number
            if (cubesNotInPlace.length != 0 && this.isEmpty) {
                Diagnostics.log("to cube");
                this.toCube = true;
                this.targetSet = true;
                return cubeBodies[cubesNotInPlace[0]].position;
            }
            
            // target is displaced cube's origin
            if (!this.isEmpty) {
                Diagnostics.log("to origin");
                this.toOrigin = true;
                this.targetSet = true;
                return cubeOrigins[cubesNotInPlace[0]];
            }
            
            // target is robot's orogin
            if (cubesNotInPlace.length == 0) {
                Diagnostics.log("to base");
                this.toBase = true;
                this.targetSet = true;
                return this.origin;
            }
        },

        command: function() {

            // raise robot
            if (this.isLanded) {

                if (!this.isOnTimeout) {
                    Diagnostics.log("timeout AA - raise from landed");
                    this.isOnTimeout = true;
                    this.timeouts.push(Time.setTimeout(() => {
                        this.raise(ROBOT_HEIGHT, 2000);                                        // timeout raising
                        this.timeouts.push(Time.setTimeout(() => {
                            this.body.position.y = ROBOT_HEIGHT + 0.1;
                            this.isOnTimeout = false;
                        }, 2000));
                    }, 500));                                                                    // timeout AA
                }

            }

            // send to target or 
            // stop and perform appropriate action
            if (this.isAloft) {

                // set target
                if (!this.targetSet) this.target = this.setTarget();
                
                // distance to target
                let dx = this.target.x - this.body.position.x;
                let dz = this.target.z - this.body.position.z;
                let distance = dx * dx + dz * dz;
        
                // send robot in the direction of target
                if (!this.isMoving) {

                    // lower robot if all cubes are in place
                    if (cubesNotInPlace.length == 0 && this.toBase && distance < ROBOT_PRECISION * 2) {
                        this.toBase = false;
                        this.isOnTimeout = true;
                        this.timeouts.push(Time.setTimeout(() => {
                            this.lower(ROBOT_HEIGHT, 2000, true);
                            this.timeouts.push(Time.setTimeout(() => {
                                
                            }, 2000));   // waiting while lowering
                        }, 500));        // waiting before lowering                              // timeout A
                    }
                    
                    let direction = new CANNON.Vec3(dx, 0, dz);
                    direction.normalize();
                    
                    if (!this.isOnTimeout) {
                        Diagnostics.log("timeout A");
                        this.isOnTimeout = true;
                        this.timeouts.push(Time.setTimeout(() => {
                            Diagnostics.log("robot is moving");
                            this.body.velocity.x = direction.x * ROBOT_SPEED;
                            this.body.velocity.z = direction.z * ROBOT_SPEED;
                            this.isOnTimeout = false;
                        }, 500));    // waiting before start moving                              // timeout A
                    }
        
                // pick / drop cube or land on base
                } else {
        
                    if (distance < ROBOT_PRECISION * 3) {
                        
                        // reached displaced cube
                        if (this.toCube) {
                            Diagnostics.log("timeout B");
                            this.body.velocity.set(0, 0, 0);
                            
                            this.isOnTimeout = true;
                            this.timeouts.push(Time.setTimeout(() => {
                                this.lower(0.1, 500, false);

                                this.timeouts.push(Time.setTimeout(() => {
                                    if (world.constraints.length == 0) {
                                        let pivotA = new CANNON.Vec3(0, 0,     0);
                                        let pivotB = new CANNON.Vec3(0, 0.200, 0);
                                        let hook = new CANNON.PointToPointConstraint(this.body, pivotA, cubeBodies[cubesNotInPlace[0]], pivotB);
                                        world.addConstraint(hook);
                                        cubeBodies[cubesNotInPlace[0]].quaternion.setFromAxisAngle(new CANNON.Vec3(0, 0, 0), 0);
                                        cubeBodies[cubesNotInPlace[0]].torque.set(0, 0, 0);
                                        this.carryingCube = cubesNotInPlace[0];
                                    }
                                    this.isEmpty = false;
                                    this.raise(0.1, 500);
                                    this.timeouts.push(Time.setTimeout(() => {
                                        this.body.position.y = 0.1 + ROBOT_HEIGHT;
                                        cubeBodies[cubesNotInPlace[0]].type = CANNON.Body.KINEMATIC;
                                        this.targetSet = false;
                                        Diagnostics.log("ready to set target to origin");
                                        this.isOnTimeout = false;
                                    }, 500));
                                }, 1000));                                                       // timeout B
                            }, 500));
                            
                            this.toCube = false;
                        }
                    
                        // reached displaced cube's origin
                        if (this.toOrigin) {
                            Diagnostics.log("timeout D");
                            this.body.velocity.set(0, 0, 0);
                            this.body.position.x = cubeOrigins[cubesNotInPlace[0]].x;
                            this.body.position.z = cubeOrigins[cubesNotInPlace[0]].z;
                            
                            // cubeBodies[cubesNotInPlace[0]].force.set(0, -1e3, 0);
                            // cubeBodies[cubesNotInPlace[0]].mass = 1e1;
                            
                            this.isOnTimeout = true;
                            this.timeouts.push(Time.setTimeout(() => {
                                // cubeBodies[cubesNotInPlace[0]].mass = CUBE_MASS;
                                cubeBodies[cubesNotInPlace[0]].quaternion.setFromAxisAngle(new CANNON.Vec3(0, 0, 0), 0);
                                
                                this.lower(0.1, 500, false);
                                
                                this.timeouts.push(Time.setTimeout(() => {
                                    this.carryingCube = -1;
                                    world.removeConstraint(world.constraints[0]);
                                    cubeBodies[cubesNotInPlace[0]].type = CANNON.Body.DYNAMIC;
                                    cubeBodies[cubesNotInPlace[0]].sleepState = false;
                                    cubeBodies[cubesNotInPlace[0]].torque.set(0, 0, 0);
                                    cubeBodies[cubesNotInPlace[0]].inertia.set(0, 0, 0);
                                    cubeBodies[cubesNotInPlace[0]].force.set(0, -1e2, 0);
                                    cubesNotInPlace.shift();
                                    this.isEmpty = true;

                                    Diagnostics.log("displaced cubes: " + cubesNotInPlace.length);
                                    
                                    this.raise(0.1, 500);
                                    this.timeouts.push(Time.setTimeout(() => {
                                        this.body.position.y = 0.1 + ROBOT_HEIGHT;
                                        this.targetSet = false;
                                        this.isOnTimeout = false;
                                        Diagnostics.log("ready to set target to base");
                                    }, 500));    // waiting while rising
                                }, 1000));       // waiting while lowering and before picking
                            }, 500));            // waiting before lowering                      // timeout D

                            this.toOrigin = false;
                        }
        
                        // reached base
                        if (this.toBase) {
                            Diagnostics.log("timeout F");
                            this.body.velocity.set(0, 0, 0);
                            
                            this.isOnTimeout = true;
                            this.timeouts.push(Time.setTimeout(() => {
                                this.lower(ROBOT_HEIGHT, 2000, true);
                                this.timeouts.push(Time.setTimeout(() => {
                                    this.isOnTimeout = false;
                                }, 2000));   // waiting while lowering
                                this.isOn = false;
                                this.targetSet = false;
                            }, 500));    // waiting before lowering                              // timeout F
                            
                            this.toBase = false;
                        }
                    }
        
                }
            }

        },
    
        raise: function(height, duration) {
            this.isOnTimeout = true;
            Diagnostics.log("raise start");
            this.body.velocity.y = height / duration * 2000;
            this.timeouts.push(Time.setTimeout(() => {
                this.body.velocity.y = 0;
                Diagnostics.log("raise stop");
            }, duration));
        },
    
        lower: function(height, duration, shutDown) {
            this.isOnTimeout = true;
            Diagnostics.log("lower start");
            this.body.velocity.y = -height / duration * 2000;
            this.timeouts.push(Time.setTimeout(() => {
                this.body.velocity.y = 0;
                Diagnostics.log("lower stop");
                if (shutDown) {
                    this.shutDown();
                }
            }, duration));
        }
    };
