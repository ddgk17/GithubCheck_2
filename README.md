# RevMcp: MCP Agent for IDA Pro

## Overview
RevMcp is an MCP (Model Context Protocol) agent for IDA Pro, designed to expose IDA's reverse engineering functionalities to external AI clients via JSON-RPC. It supports both standard and unsafe (debugger) operations, enabling advanced automation and analysis workflows.

## Features
- Metadata and function queries
- Decompilation and disassembly
- Cross-references and entry points
- Comments, renaming, and type management
- Debugger control (unsafe mode)
- JSON-RPC server for MCP client integration

## Project Structure
```
src/ida_mcp/
  mcp_plugin.py        # MCPAgent class with all functionalities
  mcp_server.py        # (Optional) MCP server logic
  jsonrpc_server.py    # JSON-RPC server entry point
```

## Requirements
- Python 3.11+
- IDA Pro 8.3+ (with IDAPython)
- MCP-compatible client (VSCode, Cline, Claude, etc.)

## Installation
1. Clone this repository:
   ```
   git clone <your-repo-url>
   ```
2. Install dependencies (if any):
   ```
   pip install -r requirements.txt
   ```
3. Start the JSON-RPC server:
   ```
   python src/ida_mcp/jsonrpc_server.py
   ```

## Usage
- Connect your MCP client to the server (default port: 13337).
- Use the available methods as documented in `mcp_plugin.py`.
- Enable unsafe functions by calling `enable_unsafe()` on the agent (or via a special method).

## Extending
To add new IDA functionalities, implement new methods in `MCPAgent` and expose them via the JSON-RPC server.

## Notes
- No code is copied from any reference repository; all logic is original.
- Unsafe debugger functions require explicit enabling for security.

## License
MIT
