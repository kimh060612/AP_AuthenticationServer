import { Injectable } from '@nestjs/common';
import { hash, genSalt, compareSync } from 'bcrypt';
import { randomBytes } from 'crypto';
import { RequestError } from 'src/common/error/ErrorEntity/RequestError';
import { RequestErrorTypeEnum } from 'src/common/error/ErrorType/RequestErrorType.enum';
import { CaregiverRepository } from 'src/common/repository/caregiver.repository';
import { ElderlyRepository } from 'src/common/repository/elderly.repository';
import { AgreementEnum } from 'src/common/types/agreement.type';
import { ElderlyInfoDto } from './dtos/elderlyInfo.dto';
import { LinkCaregiverDto } from './dtos/linkCaregiver.dto';
import { baseUrlConfig } from '../../common/configs/url/url.config';
import { ElderlySearchDto } from './dtos/elderlySearch.dto';
import { ElderlyEntity } from 'src/common/entity/elderly.entity';
import { AppError } from 'src/common/error/ErrorEntity/AppError';
import { AppErrorTypeEnum } from 'src/common/error/ErrorType/AppErrorType.enum';
import { JwtService } from '@nestjs/jwt';
import { ElderlyTokenPayloadDto } from '../../common/dtos/elderly/token-payload.dto';
import { UserTypeEnum } from 'src/common/types/user.type';

@Injectable()
export class ElderlyService {
    constructor(
        private readonly elderlyRepository: ElderlyRepository,
        private readonly cgRepository: CaregiverRepository,
        private readonly jwtService: JwtService
    ) {}

    async registerElderly(info: ElderlyInfoDto) {
        const { cg_email, ...e_info } = info;
        const _u = await this.cgRepository.findUserByEmail(cg_email);
        if (_u === null) throw new RequestError(RequestErrorTypeEnum.USER_NOT_FOUND);
        const _e = this.elderlyRepository.create({ 
            ...e_info, 
            agreement: AgreementEnum.agree, 
            caregiver_id: _u
        });

        const token = randomBytes(20).toString('hex'); // work as refresh token
        const salt = await genSalt();
        const tokenHash = await hash(token, salt);
        _e.token = tokenHash;
        await this.elderlyRepository.save(_e); // save refresh token in DB

        return { 
            url: `${baseUrlConfig()}/elderly/verify/${Buffer.from(cg_email, 'utf-8').toString('base64')}/${token}` // 링크를 QR 코드로 전달
        };
    }

    async linkWithCaregiver(link: LinkCaregiverDto) {
        const _u = await this.cgRepository.findUserByEmail(link.cg_email);
        const _e = await this.elderlyRepository.findElderlyById(link.elderly_id);
        if (_e === null || _u === null) throw new RequestError(RequestErrorTypeEnum.USER_NOT_FOUND);

        await this.elderlyRepository.update({
            uuid: link.elderly_id
        }, {
            caregiver_id: _u
        });                

        return "Successfully link Elderly with Caregiver!";
    }

    async verifyElderly(token: string, email: string, info: ElderlySearchDto) {
        const cg_email = Buffer.from(email, 'base64').toString('utf-8');
        const _u = await this.cgRepository.findUserByEmail(cg_email);
        if (_u === null) throw new RequestError(RequestErrorTypeEnum.USER_NOT_FOUND);
        const [_e_list, _] = await this.elderlyRepository.findElderlyByNameAndCG(info.name, _u.uuid);
        const _e = _e_list.map((elderly) => {
            if (elderly.birthday === info.birthdate && elderly.phone_number === info.phone_number) return elderly;
            else return false;
        });
        
        let verifyResult = false, elderly_id = null;
        _e.forEach((elderly) => {
            if (elderly instanceof ElderlyEntity) {
                const res = compareSync(token, elderly.token);
                if (res) { 
                    verifyResult = true;
                    elderly_id = elderly.uuid;
                }
            }
        });

        if (verifyResult) {
            const payload: ElderlyTokenPayloadDto = {
                elderly_id: elderly_id,
                status: UserTypeEnum.ELDERLY
            };
            const accessToken = this.jwtService.sign(payload);
            return {
                access: accessToken
            };
        }
        else throw new AppError(AppErrorTypeEnum.INVALID_VERIFICATION);
    }
}
