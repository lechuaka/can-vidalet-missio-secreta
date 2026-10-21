# Can Vidalet: Missió secreta

Prototip web multijugador escolar amb Node.js, Express i Socket.IO. Interfície en català; dissenyat per a partides de classe, sense violència.

## Inclou
- Sala amb codi i fins a 40 alumnes (més el mestre).
- Moviment entre zones, rols secrets, tasques i minijocs senzills.
- Reunions, votacions, sabotatge no violent i panell del mestre.
- El mestre crea la sala i rep un PIN privat.

## Requisits
Node.js 18 o posterior i accés a un allotjament que permeti executar un servidor Node.js persistent i connexions WebSocket.

## Executar localment per provar
1. Instal·la Node.js.
2. Obre un terminal dins d'aquesta carpeta.
3. Executa `npm install`
4. Executa `npm start`
5. Obre `http://localhost:3000`.

Per provar amb diversos ordinadors de la mateixa xarxa local, l'ordinador servidor i els portàtils han d'estar a la mateixa xarxa i el tallafoc ha de permetre el port 3000. Des dels portàtils, obre `http://IP-LOCAL-DEL-SERVIDOR:3000`.

## Publicar a Internet
Cal desplegar aquesta carpeta en un servei que admeti Node.js i WebSockets. Configura el comandament d'inici `npm start`. Després comparteix l'adreça HTTPS amb els alumnes. No publiquis el PIN del mestre.

## Important: prototip
Aquesta és una primera base de desenvolupament, no una versió validada per a una classe real. Abans d'utilitzar-la amb alumnes, cal provar-la a fons i revisar la lògica de victòria, la gestió de desconnexions, la privacitat, els permisos d'administració i les votacions. No s'han d'introduir noms complets ni dades personals dels infants.
