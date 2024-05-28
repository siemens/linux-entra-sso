# Single Sign On via Microsoft Identity Broker

This browser plugin uses a locally running microsoft identity broker
to authenticate the current user on Azure Entra ID. By that, also sites
behind conditional access policies can be accessed.

## TODO

Currently, only the second reload of the Entra ID page has access to the
authentication data, as the PRT cookie is injected after the page is loaded.
By rewriting this plugin to the webrequests API, this can be solved.
