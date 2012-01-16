//Set it up
var http = require("http"); //HTTP Server
var url = require("url"); // URL Handling
var fs = require('fs'); // Filesystem Access (writing files)
var glob = require('glob'); // Easy directory searches (from python)
var express = require('express'), //App Framework (similar to web.py abstraction)
    app = express.createServer();
	app.use(express.bodyParser());
	app.use(app.router);
io = require('socket.io').listen(app); //Socket Creations
io.set('log level', 1)

var serialport = require("serialport") //Serial Port Creation
var SerialPort = require("serialport").SerialPort 
var serialPort = new SerialPort(glob.globSync("/dev/tty.u*")[0],{baudrate:57600,parser:serialport.parsers.readline("\n") });
var datastream = ""

//MongoDB stuff
db_connected = false
try
{
	var Mongolian = require("mongolian")
	var server = new Mongolian
	var db = server.db("test")
	var collection = db.collection("holdit")
	db_connected = true
}
catch (err)
{
	console.log(err)
}

//Logging Hack because I'm tired 
var sys = require('sys')
var exec = require('child_process').exec;
function puts(error, stdout, stderr) { sys.puts(stdout) }
//exec("ls -la", puts);


//Express Redirects
//Static Redirects
app.use("/flot", express.static(__dirname + '/flot'));
app.use("/socket.io", express.static(__dirname + '/node_modules/socket.io/lib'));


//On Home Page
app.get('/', function(req, res){
	indexer = fs.readFileSync('index.html').toString()
    res.send(indexer);
});

//Define Debug Page 
//Use for debugging ardustat features
app.get('/debug', function(req, res){
	indexer = fs.readFileSync('debug.html').toString()
    res.send(indexer);
});

//CV Page
app.get('/cv', function(req, res){
	indexer = fs.readFileSync('cv.html').toString()
    res.send(indexer);
});


//Accept data (all pages, throws to setStuff()
app.post('/senddata', setStuff,function(req, res,next){
	//console.log(req.body)
	res.send(req.body)
	
});

//Presocket Connect, may reuse when flat files/mongodb is implements
app.post('/getdata',function(req, res){
	res.send(req.app.settings)
});

//Start listener on this port
//TODO: link to aruino id: e.g. board 16 is port 8016
app.listen(8888);
console.log('Express server started on port %s', app.address().port);

//Program Functions
function setStuff(req,res)
{
	//loops to false
	//If arducomm (e.g. direct signal to ardustat)
	if (req.body.arducomm != undefined) serialPort.write(req.body.arducomm)
	
	if (req.body.logger != undefined)
	{
		
		logger = req.body.logger
		//console.log(logger)
		if (logger == "started")
		{
			console.log("starting log")
			profix = req.body.datafilename +"_"+ new Date().getTime().toString()
			datafile = profix+".ardudata"
			if (db_connected) collection = db.collection(profix)
		  
		}
		else if (logger = "stopped")
		{
			console.log("stopping log")
		}
	}

	//If abstracted command (potentiostat,cv, etc)
	if (req.body.command != undefined)
	{
		calibrate = false
		cv = false
		arb_cycling = false
		
		command = req.body.command;
		value = req.body.value;
		if (command == "calibrate")
		{
			console.log("calibration should start");
			calibrator(req.body.value);
		}
		
		if (command == "ocv")
		{
			console.log("setting ocv");
			ocv()
		}
		
		if (command == "potentiostat")
		{
			console.log("setting potentiostat");
			potentiostat(value)
		}
		if (command == "galvanostat")
		{
			console.log("setting galvanostat");
			galvanostat(value)
		}
		if (command == "moveground")
		{
			console.log("setting galvanostat");
			moveground(value)
		}
		if (command == "cv")
		{
			console.log("setting cv!");
		
			cv_start_go(value)
		}
		
	}
	res.send(req.body)
	
}

//Global Variables for CV
cv = false
cycling = false
cv_set = 0
cv_dir = 1
cv_rate = 1000
cv_max = 1
cv_min = -1
cv_cycle = 1
cv_cycle_limit = 1
cv_step = 0
cv_time  = new Date().getTime()	
cv_arr = []
last_comm = ""
cv_comm = ""
cv_settings = {}
//Global Variables for Logging
logger = "stopped"
datafile = ""


//Global Variablew for Arb Cyclingq
arb_cycling = false
arb_cycling_settings = {}

//Abstracted Electrochemical Functions

//Initiate CV
function cv_start_go(value)
{
		cv_arr = []
		moveground(2.5)
		//convert mV/s to a wait time
		cv_dir = 1
		cv_rate =  (1/parseFloat(value['rate']))*1000*5
		cv_max = parseFloat(value['v_max'])
		cv_min = parseFloat(value['v_min'])
		cv_start = parseFloat(value['v_start'])
		cv_cycle_limit = parseFloat(value['cycles']*2)
		cv_cycle = 0
		cv = true
		cv_time  = new Date().getTime()	
		cv_step = cv_start
		potentiostat(cv_step)
		cv_settings = value
		cv_settings['cycle'] = cv_cycle
		
}

//Step through CV
function cv_stepper()
{
	
	time = new Date().getTime()	
	if (time - cv_time > cv_rate)
	{
		console.log("next step")
		cv_time = time 
		cv_step = cv_step + cv_dir*.005
		if (cv_step > cv_max & cv_dir == 1)
		{
			cv_dir = -1
			cv_cycle++
		}
		
		else if (cv_step < cv_min & cv_dir == -1)
		{
			cv_dir = 1
			cv_cycle++
		}
		if (cv_cycle > cv_cycle_limit) 
		{
			cv = false
			setTimeout(function(){ocv()},1000)
		}
		else
		{
			console.log(cv_step)
			potentiostat(cv_step)
		}
	}
}

//Set to OCV
function ocv()
{
	toArd("-",0000)
}

//Set Potentiostat
function potentiostat(value)
{
	value_to_ardustat = value / volts_per_tick;
	toArd("p",value_to_ardustat)
	
}

//Allow negative values
function moveground(value)
{
	value_to_ardustat = value / volts_per_tick;
	toArd("d",value_to_ardustat)
	ocv()
}

//Set Galvanostat
function galvanostat(value)
{
	//First Match R
	r_guess = .1/value
	//console.log(r_guess)
	target = 1000000
	r_best = 0
	set_best = 0
	for (var key in res_table)
	{
		if (Math.abs(r_guess-res_table[key]) < target)
		{
			//console.log("got something better")
			target = Math.abs(r_guess-res_table[key]) 
			r_best = res_table[key]
			set_best = key
			
		}
	} 

	//now solve for V
	delta_potential = value*r_best
	//console.log(r_best)
	//console.log(set_best)
	//console.log(delta_potential)
	
	value_to_ardustat = delta_potential / volts_per_tick;
	toArd("r",parseInt(set_best))
	toArd("g",parseInt(value_to_ardustat))
	
}



//Global Functions for Data Parsing
id = 20035;
vpt = undefined; //volts per tick
mode = 0;
var res_table;

//Break Arduino string into useful object
function data_parse(data)
{
	parts = data.split(",")
  	out = {}

	//the raw data
	//console.log(data)
	out['dac_set'] = parseFloat(parts[1])
	out['cell_adc'] = parseFloat(parts[2])
	out['dac_adc'] = parseFloat(parts[3])
	out['res_set'] = parseFloat(parts[4])
	out['mode'] = parseInt(parts[6])
	out['gnd_adc'] = parseFloat(parts[8])
	out['ref_adc'] = parseFloat(parts[9])
	out['twopointfive_adc'] = parseFloat(parts[10])
	out['id'] = parseInt(parts[11])
	out['last_comm'] = last_comm
	//making sense of it
	volts_per_tick = 	2.5/out['twopointfive_adc']
	if (vpt == undefined) vptt = volts_per_tick;
	if (id != out['id'])
	{
		id = out['id'];
		res_table = undefined
	}
	
	
	if (mode != out['mode'])
	{
		mode = out['mode'];
		
	}
	out['cell_potential'] = (out['cell_adc'] - out['gnd_adc']) * volts_per_tick
	out['dac_potential'] = (out['dac_adc'] - out['gnd_adc'])*volts_per_tick
	out['ref_potential'] = out['ref_adc']*volts_per_tick
	out['gnd_potential'] = out['gnd_adc']*volts_per_tick
	out['working_potential'] = (out['cell_adc'] - out['ref_adc']) * volts_per_tick
	
	if (res_table == undefined)
	{
		try
		{
			res_table = JSON.parse(fs.readFileSync("unit_"+id.toString()+".json").toString())
			console.log("loaded table "+id.toString())
			
			
		}
		catch (err)
		{
			console.log(err)
			console.log("no table "+id.toString())
			res_table = "null"
		}
	}
	
	if (res_table.constructor.toString().indexOf("Object")>-1)
	{
		out['resistance'] = res_table[out['res_set']]
		current = (out['dac_potential']-out['cell_potential'])/out['resistance']
		if (mode == 1) out['current'] = 0
		else out['current'] = current
	}
	
	return out
}



//CALIBRATION PORTION
//What happens
//1) We intitialize a counter, a loop counter,a loop limit and a callibration array
//2) When the function is called we flip the boolean and scan 
calibrate = false
counter = 0
calloop = 0
callimit = 2
calibration_array = []
rfixed = 10000


function calibrator(value)
{
	rfixed = parseFloat(value)
	//console.log(rfixed)
	calibrate = false
	counter = 0
	calloop = 0
	serialPort.write("R0255")
	setTimeout(function(){calibrate = true},100)
}

function calibrate_step()
{
		counter++;
		if (counter > 255)
		{
			counter = 0	
			calloop++
			if (calloop > callimit)
			{
				calibrate = false
				out_table = {}
				for (i = 0; i < calibration_array.length; i++)
				{
					this_foo = calibration_array[i]
					res_set = this_foo['res_set']
					dac_potential = this_foo['dac_potential']
					cell_potential = this_foo['cell_potential']
					gnd_potential = this_foo['gnd_potential']
					res_value = rfixed*(((dac_potential-gnd_potential)/(cell_potential-gnd_potential)) - 1)					
					if (out_table[res_set] == undefined) out_table[res_set] = []
					out_table[res_set].push(res_value)
				}
				//console.log(out_table)
				final_table = {}
				for (var key in out_table)
				{
					if (out_table.hasOwnProperty(key)) 
					{
						arr = out_table[key]
						sum = 0
						for (var i = 0; i < arr.length; i ++)
						{
							sum = sum + arr[i]
						}
						average = sum/(arr.length)
						final_table[key] = average
					}
				  
				}
				//console.log(final_table)
				fs.writeFileSync("unit_"+id.toString()+".json",JSON.stringify(final_table))
				res_table = undefined;
			}
		} 
		setTimeout(function(){toArd("r",counter)},50);
}


//Serial Port Interactions


t1 = setInterval(function(){
	queuer.push("s0000");
	if (calibrate)
	{   
		calibrate_step()
	}
	
	if(cv)
	{
		cv_stepper()
	}
	
},100)

t2 = setInterval(function(){
	
	if (queuer.length > 0)
	{
		sout = queuer.shift();
		//if (sout != "s0000") console.log(sout);
		serialPort.write(sout);	
	}

},20)


var queuer = []
function toArd(command,value)
{
	last_comm = ardupadder(command,value)
	//serialPort.write(ardupadder(command,value));	
	queuer.push(ardupadder(command,value))
	//console.log(queuer)
}


serialPort.on("data", function (data) {
	if (data.search("GO")>-1)
	{
		foo = data_parse(data);
		d = new Date().getTime()	
		foo['time'] = d
		
		if (cv) foo['cv_settings'] = cv_settings
		if (arb_cycling) foo['arb_cycling'] = arb_cycling_settings
		
		if (calibrate)
		{
			calibration_array.push(foo)
		}
		
		if (logger=="started")
		{
			if (db_connected) 
			{
				collection.insert(foo)
			}
			exec("echo '"+JSON.stringify(foo)+"' >> data/"+datafile);
			
		}
		foo['logger'] = logger	 	
		foo['datafile'] = datafile
		io.sockets.emit('new_data',{'ardudata':foo} )
		app.set('ardudata',foo)
		

	}
		
	
});

function ardupadder(command,number)
{
	number = parseInt(number)
	if (number < 0) number=Math.abs(number)+2000
	//console.log(number)
	padding = "";
	if (number < 10) padding = "000";
	else if (number < 100) padding= "00";
	else if (number < 1000) padding= "0";
	ard_out = command+padding+number.toString()
	return ard_out
	
}