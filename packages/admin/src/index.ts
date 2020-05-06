import {isNil} from 'lodash';
import {hashPassword, verifyToken} from './utils/auth';
import {Router, Handler, Request, Response, NextFunction} from 'express';
import {AuthHandlers} from './handlers/auth';
import {AdminSchema} from './models/Admin';
import {ConduitError, ConduitRouteParameters, ConduitSDK, IConduitAdmin} from '@conduit/sdk';
import AdminConfigSchema from './config/admin';
import * as grpc from "grpc";

let protoLoader = require('@grpc/proto-loader');
import fs from 'fs';
import path from 'path';

export default class AdminModule extends IConduitAdmin {
    private readonly router: Router;
    conduit: ConduitSDK;

    constructor(conduit: ConduitSDK, server: grpc.Server, packageDefinition: any) {
        super(conduit);
        this.router = Router();

        this.conduit = conduit;
        const {config} = conduit as any;

        const databaseAdapter = conduit.getDatabase();

        this.registerSchemas(databaseAdapter);

        const AdminModel = databaseAdapter.getSchema('Admin');

        AdminModel.findOne({username: 'admin'})
            .then((existing: any) => {
                if (isNil(existing)) {
                    const hashRounds = config.get('admin.auth.hashRounds');
                    return hashPassword('admin', hashRounds);
                }
                return Promise.resolve(null);
            })
            .then((result: string | null) => {
                if (!isNil(result)) {
                    return AdminModel.create({username: 'admin', password: result});
                }
            })
            .catch(console.log);

        const adminHandlers = new AuthHandlers(conduit);

        conduit.getRouter().registerDirectRouter('/admin/login',
            (req: Request, res: Response, next: NextFunction) => adminHandlers.loginAdmin(req, res, next).catch(next));
        conduit.getRouter().registerRouteMiddleware('/admin', this.adminMiddleware);
        this.router.use((req, res, next) => this.authMiddleware(req, res, next));
        conduit.getRouter().registerExpressRouter('/admin', this.router);

        var protoDescriptor = grpc.loadPackageDefinition(packageDefinition);

        //grpc stuff
        // @ts-ignore
        let admin = protoDescriptor.conduit.core.Admin;
        server.addService(admin.service, {
            registerAdminRoute: this.registerAdminRoute.bind(this),
        })
    }

    static get config() {
        return AdminConfigSchema;
    }

    private registerSchemas(adapter: any) {
        adapter.createSchemaFromAdapter(AdminSchema);
    }

    //grpc
    registerAdminRoute(call: any, callback: any) {
        let protofile = call.request.protoFile
        let routes: [{ path: string, method: string, grpcFunction: string }] = call.request.routes;
        let protoPath = path.resolve(__dirname, Math.random().toString(36).substring(7));
        fs.writeFileSync(protoPath, protofile);
        var packageDefinition = protoLoader.loadSync(
            protoPath,
            {
                keepCase: true,
                longs: String,
                enums: String,
                defaults: true,
                oneofs: true
            });
        let adminDescriptor: any = grpc.loadPackageDefinition(packageDefinition);
        //this can break everything change it
        while (Object.keys(adminDescriptor)[0] !== 'Admin') {
            adminDescriptor = adminDescriptor[Object.keys(adminDescriptor)[0]];
        }
        adminDescriptor = adminDescriptor[Object.keys(adminDescriptor)[0]];
        let serverIp = call.request.adminUrl;
        let client = new adminDescriptor(serverIp, grpc.credentials.createInsecure())
        routes.forEach(r => {
            let handler = (req: any, res: any, next: any) => {
                const context = (req as any).conduit;
                let params: any = {}
                if (req.query) {
                    Object.assign(params, req.query);
                }
                if (req.body) {
                    Object.assign(params, req.body);
                }
                if (req.params) {
                    Object.assign(params, req.params);
                }
                if (params.populate) {
                    if (params.populate.includes(',')) {
                        params.populate = params.populate.split(',');
                    } else {
                        params.populate = [params.populate];
                    }
                }
                let request = {
                    params: JSON.stringify(params),
                    header: JSON.stringify(req.headers),
                    context: JSON.stringify(context)
                }
                client[r.grpcFunction](request, (err: any, result: any) => {
                    if (err) {
                        return res.status(500).send(err);
                    }
                    res.status(200).json(result);
                });
            }
            this.registerRoute(r.method, r.path, handler)
        })
        //perhaps wrong(?) we send an empty response
        callback(null, null);
    }

    registerRoute(method: string, route: string, handler: Handler) {
        switch (method) {
            case 'GET':
                this.router.get(route, handler);
                break;
            case 'POST':
                this.router.post(route, handler);
                break;
            case 'PUT':
                this.router.put(route, handler);
                break;
            case 'DELETE':
                this.router.delete(route, handler);
                break;
            default:
                this.router.get(route, handler);
        }
    }

    authMiddleware(req: Request, res: Response, next: NextFunction) {
        const {config} = this.conduit as any;

        const adminConfig = config.get('admin');

        const databaseAdapter = this.conduit.getDatabase();

        const AdminModel = databaseAdapter.getSchema('Admin');

        const tokenHeader = req.headers.authorization;
        if (isNil(tokenHeader)) {
            return res.status(401).json({error: 'No token provided'});
        }

        const args = tokenHeader.split(' ');
        if (args.length !== 2) {
            return res.status(401).json({error: 'Invalid token'});
        }

        const [prefix, token] = args;
        if (prefix !== 'JWT') {
            return res.status(401).json({error: 'The authorization header must begin with JWT'});
        }
        let decoded;
        try {
            decoded = verifyToken(token, adminConfig.auth.tokenSecret);
        } catch (error) {
            return res.status(401).json({error: 'Invalid token'});
        }
        const {id} = decoded;

        AdminModel.findOne({_id: id})
            .then((admin: any) => {
                if (isNil(admin)) {
                    return res.status(401).json({error: 'No such user exists'});
                }
                (req as any).admin = admin;
                next();
            })
            .catch((error: Error) => {
                console.log(error);
                res.status(500).json({error: 'Something went wrong'});
            });
    }

    adminMiddleware(context: ConduitRouteParameters) {
        return new Promise((resolve, reject) => {
            const masterkey = context.headers.masterkey;
            if (isNil(masterkey) || masterkey !== (this.conduit as any).config.get('admin.auth.masterkey'))
                throw new ConduitError('UNAUTHORIZED', 401, 'Unauthorized');
            resolve("ok");
        })
    }

}
