var fs = require("fs");

function ip2long(IP) {
	var i = 0;
	IP = IP.match(/^([1-9]\d*|0[0-7]*|0x[\da-f]+)(?:\.([1-9]\d*|0[0-7]*|0x[\da-f]+))?(?:\.([1-9]\d*|0[0-7]*|0x[\da-f]+))?(?:\.([1-9]\d*|0[0-7]*|0x[\da-f]+))?$/i);
	if (!IP) {
		return false; // Invalid format.
	}
	IP[0] = 0;
	for (i = 1; i < 5; i += 1) {
		IP[0] += !! ((IP[i] || '').length);
		IP[i] = parseInt(IP[i]) || 0;
	}
	IP.push(256, 256, 256, 256);
	IP[4 + IP[0]] *= Math.pow(256, 4 - IP[0]);
	if (IP[1] >= IP[5] || IP[2] >= IP[6] || IP[3] >= IP[7] || IP[4] >= IP[8]) {
		return false;
	}
	return IP[1] * (IP[0] === 1 || 16777216) + IP[2] * (IP[0] <= 2 || 65536) + IP[3] * (IP[0] <= 3 || 256) + IP[4] * 1;
}

function SxGeo(filepath,callback){
	var that = this;
	fs.open(filepath,"r",function(err,fd){
		if (err){console.log(err);}
		else{
			var buff = new Buffer(40);
			that.fd = fd;
			fs.read(fd,buff,0,buff.length,0,function(err,bytesRead,buff){
				if (buff.toString('utf8',0,3) != "SxG"){
					throw ("it is not SxG file");
				}else{
					that.ver = buff.readUInt8(3);
					that.time = buff.readUInt32BE(4);
					that.type =  buff.readUInt8(8);
					that.charset = buff.readUInt8(9);
					that.b_idx_len = buff.readUInt8(10); //Элементов в индексе первых байт (до 255)
					that.m_idx_len = buff.readUInt16BE(11); //Элементов в основном индексе (до 65 тыс.)
					that.range = buff.readUInt16BE(13); //Блоков в одном элементе индекса (до 65 тыс.)
					that.db_items = buff.readUInt32BE(15); //Количество диапазонов (до 4 млрд.)
					that.id_len = buff.readUInt8(19); //Размер ID-блока в байтах (1 для стран, 3 для городов)
					that.block_len = 3+that.id_len; //Размер блока
					that.max_region = buff.readUInt16BE(20); //Максимальный размер записи региона (до 64 КБ)
					that.max_city = buff.readUInt16BE(22); //Максимальный размер записи города (до 64 КБ)
					that.region_size = buff.readUInt32BE(24); //Размер справочника регионов
					that.city_size = buff.readUInt32BE(28); //Размер справочника городов
					that.max_country = buff.readUInt16BE(32); //Максимальный размер записи страны(до 64 КБ)
					that.country_size = buff.readUInt32BE(34); //Размер справочника стран
					that.pack_size = buff.readUInt16BE(38); //Размер описания формата упаковки города/региона/страны
					that.db_begin = 40+that.pack_size+that.b_idx_len*4+that.m_idx_len*4;
					
					var buff = new Buffer(that.pack_size+that.b_idx_len*4+that.m_idx_len*4);
					
					fs.read(fd,buff,0,buff.length,40,function(err){
						if (err){throw (err);}
						else{
							var buffPos = 0;
							that.pack = buff.toString('utf8',buffPos,that.pack_size);
							buffPos = that.pack_size;
							that.b_idx_arr = []
							for (var i=0; i<that.b_idx_len; i++){
								that.b_idx_arr[i] = buff.readUInt32BE(buffPos);
								buffPos += 4;
							}
							that.m_idx_arr = []
							for (var i=0; i<that.m_idx_len; i++){
								that.m_idx_arr[i] = buff.readUInt32BE(buffPos);
								buffPos += 4;
							}
							
							callback(null);							
						}
					});
				}
			});
		}
	});
	
	function search_idx(ipn,min,max){
		while (max-min > 8){
			var offset = (min+max)>>1;
			if (ipn>that.m_idx_arr[offset]){
				min = offset;
			}
			else{
				max = offset;
			}
		}
		while (ipn > that.m_idx_arr[min] && min++ < max){};
		return min;
	}
	
	function search_db(buff,ipn,min,max){
		var ipnBuf = new Buffer(4);
		ipnBuf.writeUInt32BE(ipn,0);
		ipnBuf = ipnBuf.slice(1);
		if (max-min>1){
			while (max-min>8){
				var offset = (min+max) >> 1;
				if (ipnBuf>buff.slice(offset*that.block_len,offset*that.block_len+3)){
					min = offset;
				}
				else{
					max = offset;
				}
			}
			while (ipnBuf>=buff.slice(min*that.block_len,min*that.block_len+3) && ++min<max){};
		}
		else{
			min++;
		}
		buff = buff.slice(min*that.block_len-that.id_len-1,min*that.block_len); //Обрезать и добавить слева 1 байт, что бы было 4
		buff[0] = "0x0";
		return buff.readInt32BE(0);
		
	}
	
	this.get_num = function(ip,callback){
		var ip1n = ip.slice(0,ip.indexOf('.'));
		var ipn = ip2long(ip);
		if (ip1n == 0 || ip1n == 10 || ip1n == 127 || ip1n >= this.b_idx_len || ipn == false){
			return false;
		}
		var blocks = {
			min: that.b_idx_arr[ip1n-1],
			max: that.b_idx_arr[ip1n]
		}
		var min,max;
		if (blocks.max-blocks.min > this.range){
			var part = search_idx(ipn, Math.floor(blocks.min/this.range), Math.floor(blocks.max/this.range)-1);
			if (part>0){
				min = part*this.range
			}
			else{
				min = 0;
			}
			if (part>this.m_idx_len){
				max = this.db_items;
			}
			else{
				max = (part+1)*this.range;
			}
			if (min < blocks.min){ min = blocks.min;}
			if (max > blocks.max){ max = blocks.max;}
		}	
		else{
			max = blocks.max;
			min = blocks.min;
		}
		var len = max-min;
		console.log(max,min,len);
		var buff = new Buffer(len*this.block_len);
		fs.read(this.fd,buff,0,buff.length,this.db_begin+min*this.block_len,function(err,bytesRead,buff){
			if (err){
				callback(err);
			}
			else{
				callback(null,search_db(buff,ipn,0,len))
			}
		});
	}
}
var sxGeo = new SxGeo("SxGeoCity.dat",function(err){
	if (err){
		console.log(err);
	}
	else{
		sxGeo.get_num("37.58.37.90",function(err,data){
			if (data){
				console.log(data);
			}
		});
	}
});