![Logo](admin/sun2000.png)
# ioBroker.FusionSolar

## fusion solar adapter for ioBroker

Adapter to connect to the Huawei 'Fusion Solar' cloud

Build State: [![Build status](https://tobiaskorn.visualstudio.com/KornSW%20(OpenSource)/_apis/build/status/ioBroker.FusionSolar)](https://tobiaskorn.visualstudio.com/KornSW%20(OpenSource)/_build/latest?definitionId=44)

## Contributors wanted!

I started this project because I needed it myself. In order to be able to offer a solution that is as complete as possible, I am happy about everyone who would like to help here! Please feel free to contact me...

## Help (installation)

  1. check out the [GitHub Releases](https://github.com/KornSW/ioBroker.FusionSolar/releases) page

  2. right-click to the corresponding .tgz archive file and 'copy the link-address'

  3. go to your ioBroker admin frontend

  4. (if not done yet) enable expert mode in (in the ioBroker settings)

  5. go to the 'Adapters' page

  6. click on the GitHub-icon in the toolbar -> a dialog opens...

  7. switch to the tab on the right side to enter a custom url

  8. paste the address of the tgz file into the textbox

  9. press the button below to let ioBroker download and register it

  10. now the fusionsolar adapter should be in the collection -> select it

  11. click on the '...' icon and on the '+' icon to create an instance

  12. enter the credentials of your fusionsolar api account (if you don't have one, you can request one from: 'eu_inverter_support@huawei.com')

  13. have fun (hopefully, if huawei hopefully makes the api a little bit more stable in future ;-)


## Changelog

### 0.3.0
* (KornSW) added device related channels (now MVP candidate)
### 0.2.0
* (KornSW) login and inverter realtime KPI now working
### 0.1.0
* (KornSW) initial version (inspired by https://github.com/Newan/ioBroker.easee - thnx to Newan!)

## License

MIT License

Copyright (c) 2022 KornSW

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.