"""MCP-tööriistade registreerimine. Hoia õhuke: loogika elab teistes moodulites."""
from mcp.server.mcpserver import MCPServer


def build_server() -> MCPServer:
    """Koostab serveri koos kõigi tööriistadega.

    Eraldi funktsioon (mitte moodulitasandi instants), et testid saaksid
    puhta serveri ilma protsessi käivitamata.
    """
    mcp = MCPServer("vutt")
    _register_text_tools(mcp)
    _register_person_tools(mcp)
    return mcp


def _register_text_tools(mcp: MCPServer) -> None:
    """Tekstitööriistad — täidetakse Task 6-s."""


def _register_person_tools(mcp: MCPServer) -> None:
    """Prosopograafia tööriistad — täidetakse Task 7-s ja 8-s."""
